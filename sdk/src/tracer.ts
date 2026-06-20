import type { TraceConfig, TracePayload } from './types';
import { wrapAnthropic, type TracedAnthropic, type AnthropicClientLike } from './wrappers/anthropic';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const DEFAULT_API_URL = 'https://ingest.trace-ai.com';

export class Tracer {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  readonly runId: string;

  constructor(config: TraceConfig) {
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.runId = config.runId ?? uuid();
  }

  ingest(payload: TracePayload): void {
    fetch(`${this.apiUrl}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    }).catch((err: unknown) => console.warn('[trace-ai] ingest failed:', err));
  }

  wrapAnthropic(client: AnthropicClientLike): TracedAnthropic {
    return wrapAnthropic(client, this);
  }
}