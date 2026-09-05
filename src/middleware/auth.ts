import { Request, Response, NextFunction } from 'express';
import { Logger, generateRequestId } from '../logger';

const logger = new Logger('Auth');

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.API_TOKEN;
  if (!token) {
    next();
    return;
  }

  if (!req.path.startsWith('/api/') && !req.path.startsWith('/webhook')) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid Authorization header', { path: req.path });
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const provided = authHeader.slice(7);
  if (provided !== token) {
    logger.warn('Invalid API token', { path: req.path });
    res.status(401).json({ error: 'Invalid API token' });
    return;
  }

  next();
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  (req as any).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any).requestId || 'unknown';
  logger.error('Unhandled error', { requestId, path: req.path, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', requestId });
}
