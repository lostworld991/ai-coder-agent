import { randomBytes } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_FIELDS = ['apiKey', 'githubToken', 'password', 'token', 'secret', 'authorization'];

export interface LogContext {
  component?: string;
  requestId?: string;
  [key: string]: unknown;
}

export class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  private serialize(level: LogLevel, message: string, context?: LogContext): string {
    const ctx = context ? this.redact(context) : {};
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...ctx,
    });
  }

  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        result[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.redact(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  debug(message: string, context?: LogContext): void {
    console.debug(this.serialize('debug', message, context));
  }

  info(message: string, context?: LogContext): void {
    console.info(this.serialize('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.serialize('warn', message, context));
  }

  error(message: string, context?: LogContext): void {
    console.error(this.serialize('error', message, context));
  }
}

export function generateRequestId(): string {
  return randomBytes(8).toString('hex');
}
