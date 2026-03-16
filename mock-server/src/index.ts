// ─── Mock Server Entry Point ──────────────────────────────────────────────────
// Runs a single Express server that mocks:
//   /identityiq/scim/v2  → IIQ SCIM v2 API
//   /identityiq/rest     → IIQ REST API
//   /api/now             → ServiceNow Table API

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import scimRouter from './routes/scim';
import restRouter from './routes/rest';
import servicenowRouter from './routes/servicenow';
import { setBreakTool } from './break-tool';

const app = express();
const PORT = parseInt(process.env['MOCK_PORT'] ?? '3001', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ─── Route Mounts ─────────────────────────────────────────────────────────────

app.use('/identityiq/scim/v2', scimRouter);
app.use('/identityiq/rest', restRouter);
app.use('/api/now', servicenowRouter);

// ─── Test Config Endpoints ────────────────────────────────────────────────────
// POST /config/break-tool { "tool": "A1" }  → make that tool endpoint return 500
// DELETE /config/break-tool                 → clear the override

app.post('/config/break-tool', (req: Request, res: Response) => {
  const tool = (req.body as Record<string, unknown>)['tool'] as string | undefined;
  setBreakTool(tool ?? null);
  res.json({ break_tool: tool ?? null });
});

app.delete('/config/break-tool', (_req: Request, res: Response) => {
  setBreakTool(null);
  res.json({ break_tool: null });
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    server: 'iiq-mock-server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/identityiq/scim/v2',
      '/identityiq/rest',
      '/api/now',
    ],
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  console.warn(`[mock-server] 404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({ status: 404, message: `Route not found: ${req.method} ${req.path}` });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[mock-server] Listening on http://localhost:${PORT}`);
  console.log(`[mock-server] IIQ SCIM  → http://localhost:${PORT}/identityiq/scim/v2`);
  console.log(`[mock-server] IIQ REST  → http://localhost:${PORT}/identityiq/rest`);
  console.log(`[mock-server] ServiceNow → http://localhost:${PORT}/api/now`);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('[mock-server] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[mock-server] HTTP server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[mock-server] SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('[mock-server] HTTP server closed.');
    process.exit(0);
  });
});

export default app;
