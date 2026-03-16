from dataclasses import dataclass
from enum import Enum
import re


class IncidentType(Enum):
    ACCESS_REQUEST = "access_request"           # user submitted request but still no access
    GROUP_MEMBERSHIP = "group_membership"       # github team / AD group add/remove
    JOINER = "joiner"                           # new hire onboarding
    LEAVER = "leaver"                           # terminated user access not revoked
    AGGREGATION_HEALTH = "aggregation_health"   # sync failures, stale data
    POLICY_VIOLATION = "policy_violation"       # SoD / compliance issues


@dataclass
class Classification:
    incident_type: str          # IncidentType.value or "unknown"
    confidence: float           # 0.0 – 1.0
    raw_scores: dict            # full type → score map for logging
    incident_type_enum: IncidentType | None = None  # set when type is known


# Keyword patterns for each type (ordered by priority)
PATTERNS = [
    # Joiner patterns first (most specific)
    (IncidentType.JOINER, [
        r'\bjoin(er|er workflow|ing)\b',
        r'\bnew hire\b',
        r'\bonboard(ing)?\b',
        r'\bstart date\b',
        r'\bnewly hired\b',
        r'\bfirst day\b',
    ]),
    # Leaver patterns (terminated user still has access)
    (IncidentType.LEAVER, [
        r'\b(terminated|offboard(ing)?|leaver)\b',
        r'\bstill has access\b',
        r'\baccess (not |should be )(revoked|removed|disabled)\b',
        r'\bde-?provison(ing)?\b',
        r'\bformer (employee|user|staff)\b',
        r'\bleft (the company|employment)\b',
    ]),
    # Aggregation/sync
    (IncidentType.AGGREGATION_HEALTH, [
        r'\baggregat(e|ion|ing)\b',
        r'\bsync (fail|issue|error|problem)\b',
        r'\bstale data\b',
        r'\bdata is stale\b',
        r'\bstale\b',
        r'\btask fail(ed|ure)\b',
        r'\bidentity refresh\b',
        r'\bconnector (fail|error|down)\b',
        r'\bfail(ed|ing|ure)\b',
    ]),
    # Group membership (specific apps / group operations)
    (IncidentType.GROUP_MEMBERSHIP, [
        r'\bgithub\b',
        r'\b(ad|active directory) group\b',
        r'\b(add|remove) (me |user )?(to|from) (a |the )?(group|team)\b',
        r'\bgroup (member|membership)\b',
        r'\bsecurity group\b',
        r'\bteam member(ship)?\b',
    ]),
    # Policy violation
    (IncidentType.POLICY_VIOLATION, [
        r'\bpolicy (violation|conflict)\b',
        r'\bsod\b',
        r'\bsegregation of duties\b',
        r'\bconflicting (access|role|entitlement)\b',
        r'\bcompliance (violation|issue)\b',
    ]),
    # Access request (broadest — match last)
    (IncidentType.ACCESS_REQUEST, [
        r'\baccess request\b',
        r'\bpending approval\b',
        r'\brequested (access|role|entitlement)\b',
        r'\bapproval (pending|stuck|delay)\b',
        r'\bnot (yet )?approved\b',
        r'\bstill (don.t|do not) have access\b',
        r'\bcannot access\b',
        r'\bcan.t access\b',
        r'\bno access\b',
        r'\bneed access\b',
    ]),
]


def classify_incident(
    short_description: str,
    description: str = "",
    category: str = "",
) -> Classification:
    """
    Classify a ServiceNow ticket into an incident type.
    Returns a Classification with incident_type, confidence (0.0-1.0), and raw_scores.

    Confidence formula: top_score / (top_score + second_score).
    - Single match → confidence = 1.0
    - No match     → incident_type = "unknown", confidence = 0.0
    - Close race   → confidence approaches 0.5
    """
    text = f"{short_description} {description} {category}".lower()

    scores: dict[IncidentType, int] = {t: 0 for t in IncidentType}

    for incident_type, patterns in PATTERNS:
        for pattern in patterns:
            if re.search(pattern, text):
                scores[incident_type] += 1

    raw_scores = {t.value: s for t, s in scores.items()}

    # Find winner
    sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    top_type, top_score = sorted_scores[0]

    if top_score == 0:
        return Classification(
            incident_type="unknown",
            confidence=0.0,
            raw_scores=raw_scores,
            incident_type_enum=None,
        )

    if len(sorted_scores) == 1 or sorted_scores[1][1] == 0:
        confidence = 1.0
    else:
        second_score = sorted_scores[1][1]
        confidence = top_score / (top_score + second_score)

    return Classification(
        incident_type=top_type.value,
        confidence=round(confidence, 3),
        raw_scores=raw_scores,
        incident_type_enum=top_type,
    )
