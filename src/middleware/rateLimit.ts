import { Request, Response, NextFunction } from 'express';
import { Logger } from '../logger';

const logger = new Logger('RateLimit');

interface RateEntry {
  timestamps: number[];
}

const requests = new Map<string, RateEntry>();

export function rateLimit(maxPerMinute: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - 60_000;

    let entry = requests.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      requests.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= maxPerMinute) {
      logger.warn('Rate limit exceeded', { ip: key, path: req.path });
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }

    entry.timestamps.push(now);
    next();
  };
}
