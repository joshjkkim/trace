import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { Tracer } from '../tracer';
import type { AnthropicClientLike, MessageStreamLike, TracedMessageParams, TracedStreamParams } from '../types';
import { getCost } from '../cost';
import { TracedRun } from '../run';
import { getActiveSpanId, runWithSpan } from '../context';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type { AnthropicClientLike, TracedMessageParams };

export interface TracedAnthropicMessages {
  create(params: TracedMessageParams): Promise<Message>;
  stream(params: TracedStreamParams): MessageStreamLike;
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
        const spanId = uuid();
        const parentSpanId = getActiveSpanId();
        const start = Date.now();

        try {
          const response = await runWithSpan(spanId, () =>
            client.messages.create(cleanParams as MessageCreateParamsNonStreaming),
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
            span_id: spanId,
            parent_span_id: parentSpanId ?? undefined,
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
            span_id: spanId,
            parent_span_id: parentSpanId ?? undefined,
          });

          throw err;
        }
      },

      stream(params: TracedStreamParams): MessageStreamLike {
        const { _trace, ...cleanParams } = params;
        const currentStep = stepIndex++;
        const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
        const spanId = uuid();
        const parentSpanId = getActiveSpanId();
        const start = Date.now();

        if (!client.messages.stream) {
          throw new Error('[cernova] This Anthropic client does not support streaming.');
        }
        const messageStream = client.messages.stream(cleanParams as MessageCreateParamsNonStreaming);

        messageStream.finalMessage().then((response) => {
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
            span_id: spanId,
            parent_span_id: parentSpanId ?? undefined,
          });
        }).catch((err: unknown) => {
          const latency_ms = Date.now() - start;
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
            error: err instanceof Error ? err.message : String(err),
            span_id: spanId,
            parent_span_id: parentSpanId ?? undefined,
          });
        });

        return messageStream;
      },
    },

    run(): TracedRun {
      return new TracedRun(client, tracer);
    },
  };
}
