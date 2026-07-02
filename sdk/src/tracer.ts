import type { TraceConfig, TracePayload } from './types';
import { wrapAnthropic, type TracedAnthropic, type AnthropicClientLike } from './wrappers/anthropic';
import { wrapOpenAI, type TracedOpenAI, type OpenAIClientLike } from './wrappers/openai';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const DEFAULT_API_URL = 'https://trace-production-940c.up.railway.app';

export class Tracer {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  readonly runId: string;

  constructor(config: TraceConfig) {
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.runId = config.runId ?? uuid();
  }

  ingest(payload: TracePayload): Promise<string | null> {
    return fetch(`${this.apiUrl}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { trace_id: string }) => data.trace_id ?? null)
      .catch((err: unknown) => {
        console.warn('[cernova] ingest failed:', err);
        return null;
      });
  }

  wrapAnthropic(client: AnthropicClientLike): TracedAnthropic {
    return wrapAnthropic(client, this);
  }

  wrapOpenAI(client: OpenAIClientLike): TracedOpenAI {
    return wrapOpenAI(client, this);
  }
}
