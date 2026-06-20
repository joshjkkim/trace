import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';
import type { Tracer } from '../tracer';
import type { TraceOptions } from '../types';
import { getCost, getContextWindow } from '../cost';

// Structural interface so consumers don't need the exact same @anthropic-ai/sdk install
export interface AnthropicClientLike {
  messages: {
    create(params: MessageCreateParamsNonStreaming, options?: unknown): Promise<Message>;
  };
}

export type TracedMessageParams = MessageCreateParamsNonStreaming & {
  _trace?: TraceOptions;
};

export interface TracedAnthropicMessages {
  create(params: TracedMessageParams): Promise<Message>;
}

export interface TracedAnthropic {
  messages: TracedAnthropicMessages;
}

export function wrapAnthropic(client: AnthropicClientLike, tracer: Tracer): TracedAnthropic {
  return {
    messages: {
      async create(params: TracedMessageParams): Promise<Message> {
        const { _trace, ...cleanParams } = params;
        const stepName = _trace?.stepName ?? 'anthropic.messages.create';
        const start = Date.now();

        try {
          const response = await client.messages.create(
            cleanParams as MessageCreateParamsNonStreaming,
          );

          const latency_ms = Date.now() - start;
          const input_tokens = response.usage?.input_tokens ?? 0;
          const output_tokens = response.usage?.output_tokens ?? 0;
          const total_tokens = input_tokens + output_tokens;
          const model = response.model ?? cleanParams.model;
          const contextWindow = getContextWindow(model);

          tracer.ingest({
            run_id: tracer.runId,
            step_name: stepName,
            model,
            prompt: JSON.stringify({ system: cleanParams.system, messages: cleanParams.messages }),
            input_tokens,
            output_tokens,
            total_tokens,
            latency_ms,
            cost_usd: getCost(model, input_tokens, output_tokens),
            context_limit: contextWindow,
            context_utilization: contextWindow ? total_tokens / contextWindow : undefined,
            status: 'success',
          });

          return response;
        } catch (err: unknown) {
          const latency_ms = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);

          tracer.ingest({
            run_id: tracer.runId,
            step_name: stepName,
            model: cleanParams.model,
            prompt: JSON.stringify({ system: cleanParams.system, messages: cleanParams.messages }),
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            latency_ms,
            cost_usd: 0,
            status: 'error',
            error: message,
          });

          throw err;
        }
      },
    },
  };
}
