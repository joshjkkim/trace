import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { Tracer } from '../tracer';
import type { AnthropicClientLike, TracedMessageParams } from '../types';
import { getCost } from '../cost';
import { TracedRun } from '../run';

export type { AnthropicClientLike, TracedMessageParams };

export interface TracedAnthropicMessages {
  create(params: TracedMessageParams): Promise<Message>;
}

export interface TracedAnthropic {
  messages: TracedAnthropicMessages;
  /** Start a new run — fresh run_id, step_index resets to 0. */
  run(): TracedRun;
}

function extractOutputCode(response: Message): string | undefined {
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
  return text.length > 0 ? text : undefined;
}

export function wrapAnthropic(client: AnthropicClientLike, tracer: Tracer): TracedAnthropic {
  let stepIndex = 0;

  return {
    messages: {
      async create(params: TracedMessageParams): Promise<Message> {
        const { _trace, ...cleanParams } = params;
        const currentStep = stepIndex++;
        const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
        const start = Date.now();

        try {
          const response = await client.messages.create(
            cleanParams as MessageCreateParamsNonStreaming,
          );

          const latency_ms    = Date.now() - start;
          const input_tokens  = response.usage?.input_tokens  ?? 0;
          const output_tokens = response.usage?.output_tokens ?? 0;
          const total_tokens  = input_tokens + output_tokens;
          const model         = response.model ?? cleanParams.model;

          tracer.ingest({
            run_id: tracer.runId,
            step_name: stepName,
            step_index: currentStep,
            model,
            prompt: JSON.stringify({ system: cleanParams.system, messages: cleanParams.messages }),
            input_tokens,
            output_tokens,
            total_tokens,
            latency_ms,
            cost: getCost(model, input_tokens, output_tokens),
            status_success: true,
            output_code: extractOutputCode(response),
          });

          return response;
        } catch (err: unknown) {
          const latency_ms = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);

          tracer.ingest({
            run_id: tracer.runId,
            step_name: stepName,
            step_index: currentStep,
            model: cleanParams.model,
            prompt: JSON.stringify({ system: cleanParams.system, messages: cleanParams.messages }),
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            latency_ms,
            cost: 0,
            status_success: false,
            error: message,
          });

          throw err;
        }
      },
    },

    run(): TracedRun {
      return new TracedRun(client, tracer);
    },
  };
}
