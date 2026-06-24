import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';

export interface TraceOptions {
  stepName?: string;
}

export interface TraceConfig {
  apiKey: string;
  runId?: string;
  /** Override the ingest endpoint. Defaults to trace-ai's servers. For local dev only. */
  apiUrl?: string;
}

export interface TracePayload {
  run_id: string;
  step_name: string;
  step_index: number;
  model: string;
  prompt: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  latency_ms: number;
  cost: number;
  status_success: boolean;
  output_code?: string;
  error?: string;
  span_id?: string;
  parent_span_id?: string;
}

/** Minimal shape we need from a streaming response — the real MessageStream satisfies this. */
export interface MessageStreamLike {
  finalMessage(): Promise<Message>;
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
}

export interface AnthropicClientLike {
  messages: {
    create(params: MessageCreateParamsNonStreaming, options?: unknown): Promise<Message>;
    stream?(params: MessageCreateParamsNonStreaming, options?: unknown): MessageStreamLike;
  };
}

export type TracedMessageParams = MessageCreateParamsNonStreaming & {
  _trace?: TraceOptions;
};

export type TracedStreamParams = MessageCreateParamsNonStreaming & {
  _trace?: TraceOptions;
};
