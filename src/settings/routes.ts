import { Express, Request, Response } from 'express';
import { getSettings, saveSettings, testConnection, redactSettings } from './store';
import { Logger } from '../logger';

const logger = new Logger('SettingsAPI');

export function registerSettingsRoutes(app: Express): void {
  app.get('/api/settings', async (_req: Request, res: Response) => {
    try {
      const settings = await getSettings();
      res.json(redactSettings(settings));
    } catch (err: any) {
      logger.error('Failed to get settings', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings', async (req: Request, res: Response) => {
    try {
      const settings = await saveSettings(req.body);
      res.json(redactSettings(settings));
    } catch (err: any) {
      logger.error('Failed to save settings', { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/settings/test', async (req: Request, res: Response) => {
    try {
      const result = await testConnection(req.body);
      res.json(result);
    } catch (err: any) {
      logger.error('Connection test failed', { error: err.message });
      res.status(500).json({ ok: false, message: err.message });
    }
  });
}
