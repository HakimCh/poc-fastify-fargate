import { StatsD } from 'hot-shots';
import type { FastifyRequest } from 'fastify';

export interface DatadogConfig {
  apiKey?: string;
  host?: string;
  port?: number;
  prefix?: string;
  tags?: string[];
}

export class DatadogClient {
  private statsd: StatsD;
  private apiKey?: string;

  constructor(config: DatadogConfig = {}) {
    this.apiKey = config.apiKey || process.env.DD_API_KEY;

    this.statsd = new StatsD({
      host: config.host || process.env.DD_AGENT_HOST || 'localhost',
      port: config.port || Number(process.env.DD_AGENT_PORT) || 8125,
      prefix: config.prefix || 'eventbridge.api.',
      globalTags: config.tags || [
        `env:${process.env.NODE_ENV || 'development'}`,
        `service:eventbridge-api`,
      ],
    });
  }

  increment(metric: string, value: number = 1, tags?: string[]): void {
    this.statsd.increment(metric, value, tags);
  }

  gauge(metric: string, value: number, tags?: string[]): void {
    this.statsd.gauge(metric, value, tags);
  }

  histogram(metric: string, value: number, tags?: string[]): void {
    this.statsd.histogram(metric, value, tags);
  }

  timing(metric: string, value: number, tags?: string[]): void {
    this.statsd.timing(metric, value, tags);
  }

  distribution(metric: string, value: number, tags?: string[]): void {
    this.statsd.distribution(metric, value, tags);
  }

  async logToDatadog(level: string, message: string, context?: Record<string, any>): Promise<void> {
    if (!this.apiKey) {
      console.warn('DD_API_KEY not set, skipping Datadog log');
      return;
    }

    const log = {
      ddsource: 'nodejs',
      service: 'eventbridge-api',
      hostname: process.env.HOSTNAME || 'localhost',
      level,
      message,
      timestamp: new Date().toISOString(),
      ...context,
    };

    try {
      const response = await fetch('https://http-intake.logs.datadoghq.com/v1/input', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': this.apiKey,
        },
        body: JSON.stringify(log),
      });

      if (!response.ok) {
        console.error(`Failed to send log to Datadog: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending log to Datadog:', error);
    }
  }

  info(message: string, context?: Record<string, any>): void {
    console.log(`[INFO] ${message}`, context || '');
    this.logToDatadog('info', message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    console.warn(`[WARN] ${message}`, context || '');
    this.logToDatadog('warn', message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    console.error(`[ERROR] ${message}`, context || '');
    this.logToDatadog('error', message, context);
  }

  trackRequest(request: FastifyRequest, duration: number, statusCode: number): void {
    const tags = [
      `method:${request.method}`,
      `route:${request.routeOptions.url || 'unknown'}`,
      `status:${statusCode}`,
    ];

    this.increment('request.count', 1, tags);
    this.timing('request.duration', duration, tags);
    this.histogram('request.size', Number(request.headers['content-length']) || 0, tags);

    if (statusCode >= 500) {
      this.increment('request.error.5xx', 1, tags);
    } else if (statusCode >= 400) {
      this.increment('request.error.4xx', 1, tags);
    } else if (statusCode >= 200 && statusCode < 300) {
      this.increment('request.success', 1, tags);
    }
  }

  trackEventBridgeOperation(operation: 'send' | 'receive', success: boolean, duration?: number): void {
    const tags = [
      `operation:${operation}`,
      `success:${success}`,
    ];

    this.increment(`eventbridge.${operation}.count`, 1, tags);

    if (duration) {
      this.timing(`eventbridge.${operation}.duration`, duration, tags);
    }

    if (!success) {
      this.increment(`eventbridge.${operation}.error`, 1, tags);
    }
  }

  close(): void {
    this.statsd.close();
  }
}

export const datadog = new DatadogClient();
