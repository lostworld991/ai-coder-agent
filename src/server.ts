import express from 'express';
import { registerSettingsRoutes } from './settings/routes';
import { createWebhookHandler, initWebhookProcessor } from './github/app';
import { EventQueue } from './queue';
import { authMiddleware, requestIdMiddleware, errorHandler } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';
import { Logger } from './logger';
import path from 'path';

const logger = new Logger('Server');
const queue = new EventQueue(100);
initWebhookProcessor(queue);

const app = express();
const PORT = process.env.PORT || 8080;
const startTime = Date.now();

app.use(requestIdMiddleware);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Date.now() - startTime,
    queueDepth: queue.depth,
    version: process.env.npm_package_version || '1.0.0',
  });
});

app.use('/web', express.static(path.join(__dirname, '../web')));

app.use('/webhook', express.raw({ type: 'application/json' }), createWebhookHandler(queue));

app.use(express.json());
app.use(authMiddleware);

registerSettingsRoutes(app);

app.post('/api/agent/run', rateLimit(10), async (req, res) => {
  const { task, repo, stream } = req.body;
  const requestId = (req as any).requestId;

  if (!task || !repo) {
    res.status(400).json({ error: 'task and repo are required' });
    return;
  }

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const { getSettings } = await import('./settings/store');
      const { createProvider } = await import('./providers/index');
      const { AgentRunner } = await import('./agent/loop');

      const settings = await getSettings();
      const provider = createProvider(settings);
      const runner = new AgentRunner(provider, settings);

      const result = await runner.run({
        task,
        repoUrl: repo,
        onEvent: (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
      });

      res.write(`data: ${JSON.stringify({ type: 'done', result })}\n\n`);
      res.end();
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  try {
    const { getSettings } = await import('./settings/store');
    const { createProvider } = await import('./providers/index');
    const { AgentRunner } = await import('./agent/loop');

    const settings = await getSettings();
    const provider = createProvider(settings);
    const runner = new AgentRunner(provider, settings);
    const result = await runner.run({ task, repoUrl: repo });

    res.json(result);
  } catch (err: any) {
    logger.error('Agent run failed', { requestId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.use(errorHandler);

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`AI Coder Agent running on port ${PORT}`);
});

function shutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
