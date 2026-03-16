// ─── Break-Tool State ──────────────────────────────────────────────────────────
// Shared in-memory state for testing adaptive tier behaviour.
// When set, the mock server returns HTTP 500 for the route that implements
// the named tool, simulating a connector failure mid-sequence.
//
// Tool → route mapping:
//   A1, A2  → SCIM GET /Users
//   E1, E2  → SCIM GET /Accounts
//   B1, B2  → REST GET /accessRequests
//   C1      → REST GET /workflowInstances/:id
//   D1, D2  → REST GET /provisioningTransactions
//   F1, F2  → REST GET /taskResults

let _breakTool: string | null = null;

export function getBreakTool(): string | null {
  return _breakTool;
}

export function setBreakTool(tool: string | null): void {
  _breakTool = tool;
  if (tool) {
    console.log(`[mock-server] break_tool set to: ${tool}`);
  } else {
    console.log('[mock-server] break_tool cleared');
  }
}

/**
 * Returns true if the mock should simulate a failure for the given tool alias.
 * toolAliases: array of tool names that map to this route (e.g. ["A1", "A2"]).
 */
export function shouldBreak(toolAliases: string[]): boolean {
  return _breakTool !== null && toolAliases.includes(_breakTool);
}
