import { Logger } from './logger';

const logger = new Logger('Queue');

export interface QueueItem {
  id: string;
  event: string;
  payload: unknown;
  receivedAt: Date;
}

export class EventQueue {
  private queue: QueueItem[] = [];
  private maxSize: number;
  private processing = false;
  private handler: ((item: QueueItem) => Promise<void>) | null = null;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  enqueue(item: QueueItem): void {
    if (this.queue.length >= this.maxSize) {
      const dropped = this.queue.shift();
      logger.warn('Queue full, dropping oldest event', { droppedId: dropped?.id });
    }
    this.queue.push(item);
    this.process();
  }

  setHandler(handler: (item: QueueItem) => Promise<void>): void {
    this.handler = handler;
  }

  get depth(): number {
    return this.queue.length;
  }

  private async process(): Promise<void> {
    if (this.processing || !this.handler) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await this.handler(item);
      } catch (err: any) {
        logger.error('Event processing failed', { id: item.id, event: item.event, error: err.message });
      }
    }

    this.processing = false;
  }
}
