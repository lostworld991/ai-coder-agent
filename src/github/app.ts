import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Logger } from '../logger';
import { EventQueue } from '../queue';
import { getSettings } from '../settings/store';
import { handleCIFailure, handleReviewComment } from './workflows';

const logger = new Logger('GitHub');

export function createWebhookHandler(queue: EventQueue) {
  return async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    if (secret) {
      const hmac = createHmac('sha256', secret as string)
        .update(req.body as any)
        .digest('hex');
      const expected = `sha256=${hmac}`;
      const provided = signature || '';

      if (!safeCompare(provided, expected)) {
        logger.warn('Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const event = req.headers['x-github-event'] as string;
    const payload = JSON.parse((req.body as any).toString());

    res.status(202).json({ received: true });

    queue.enqueue({
      id: `${event}-${Date.now()}`,
      event,
      payload,
      receivedAt: new Date(),
    });

    logger.info('Webhook event queued', { event, action: (payload as any).action });
  };
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function initWebhookProcessor(queue: EventQueue): void {
  queue.setHandler(async (item) => {
    const settings = await getSettings();

    switch (item.event) {
      case 'issues':
        if ((item.payload as any).action === 'opened' && settings.autoCode) {
          const { processNewIssue } = await import('./workflows');
          await processNewIssue(item.payload, settings);
        }
        break;

      case 'issue_comment':
        if ((item.payload as any).action === 'created' && settings.autoCode) {
          const { processIssueComment } = await import('./workflows');
          await processIssueComment(item.payload, settings);
        }
        break;

      case 'pull_request':
        if ((item.payload as any).action === 'opened' && settings.autoCode) {
          const { processNewPR } = await import('./workflows');
          await processNewPR(item.payload, settings);
        }
        break;

      case 'check_run':
        if (
          (item.payload as any).action === 'completed' &&
          (item.payload as any).check_run?.conclusion === 'failure' &&
          settings.autoFix
        ) {
          await handleCIFailure(item.payload, settings);
        }
        break;

      case 'pull_request_review_comment':
        if (settings.autoFix) {
          await handleReviewComment(item.payload, settings);
        }
        break;

      default:
        logger.debug('Unhandled event type', { event: item.event });
    }
  });
}
