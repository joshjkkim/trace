import type { Tracer } from '../tracer';
import { getCost } from '../cost';
import { getActiveSpanId, runWithSpan } from '../context';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface OpenAIMessage {
  role: string;
  content: string | null;
}

export interface OpenAIChatParams {
  model: string;
  messages: OpenAIMessage[];
  [key: string]: unknown;
  _trace?: { stepName?: string };
}

export interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: OpenAIMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: Omit<OpenAIChatParams, '_trace'>, options?: unknown): Promise<OpenAIChatResponse>;
    };
  };
}

export interface TracedOpenAIChat {
  completions: {
    create(params: OpenAIChatParams): Promise<OpenAIChatResponse>;
  };
}

export interface TracedOpenAI {
  chat: TracedOpenAIChat;
}

function extractSystemAndMessages(messages: OpenAIMessage[]): { system: string | undefined; messages: OpenAIMessage[] } {
  const system = messages.find((m) => m.role === 'system')?.content ?? undefined;
  return { system: system ?? undefined, messages };
}

function extractOutputCode(response: OpenAIChatResponse): string | undefined {
  const text = response.choices[0]?.message?.content;
  return text && text.length > 0 ? text : undefined;
}

export function wrapOpenAI(client: OpenAIClientLike, tracer: Tracer): TracedOpenAI {
  let stepIndex = 0;

  return {
    chat: {
      completions: {
        async create(params: OpenAIChatParams): Promise<OpenAIChatResponse> {
          const { _trace, ...cleanParams } = params;
          const currentStep = stepIndex++;
          const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
          const spanId = uuid();
          const parentSpanId = getActiveSpanId();
          const start = Date.now();
          const { system, messages } = extractSystemAndMessages(params.messages);

          try {
            const response = await runWithSpan(spanId, () =>
              client.chat.completions.create(cleanParams),
            );

            const latency_ms    = Date.now() - start;
            const input_tokens  = response.usage?.prompt_tokens     ?? 0;
            const output_tokens = response.usage?.completion_tokens  ?? 0;
            const total_tokens  = response.usage?.total_tokens       ?? input_tokens + output_tokens;
            const model         = response.model ?? cleanParams.model;

            tracer.ingest({
              run_id: tracer.runId,
              step_name: stepName,
              step_index: currentStep,
              model,
              prompt: JSON.stringify({ system, messages }),
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
              prompt: JSON.stringify({ system, messages }),
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
      },
    },
  };
}
