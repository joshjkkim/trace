import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { Tracer } from './tracer';
import type { AnthropicClientLike, MessageStreamLike, TracedMessageParams, TracedStreamParams } from './types';
import { getCost } from './cost';
import { getActiveSpanId, runWithSpan } from './context';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function extractOutputCode(response: Message): string | undefined {
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');
  return text.length > 0 ? text : undefined;
}

export class TracedRun {
  readonly runId: string;
  readonly messages: {
    create(params: TracedMessageParams): Promise<Message>;
    stream(params: TracedStreamParams): MessageStreamLike;
  };
  private stepIndex = 0;

  constructor(
    private readonly client: AnthropicClientLike,
    private readonly tracer: Tracer,
  ) {
    this.runId = uuid();
    this.messages = {
      create: (params) => this._create(params),
      stream: (params) => this._stream(params),
    };
  }

  private async _create(params: TracedMessageParams): Promise<Message> {
    const { _trace, ...cleanParams } = params;
    const currentStep = this.stepIndex++;
    const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
    const spanId = uuid();
    const parentSpanId = getActiveSpanId();
    const start = Date.now();

    try {
      const response = await runWithSpan(spanId, () =>
        this.client.messages.create(cleanParams as MessageCreateParamsNonStreaming),
      );

      const latency_ms    = Date.now() - start;
      const input_tokens  = response.usage?.input_tokens  ?? 0;
      const output_tokens = response.usage?.output_tokens ?? 0;
      const total_tokens  = input_tokens + output_tokens;
      const model         = response.model ?? cleanParams.model;

      this.tracer.ingest({
        run_id: this.runId,
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

      this.tracer.ingest({
        run_id: this.runId,
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
  }

  private _stream(params: TracedStreamParams): MessageStreamLike {
    const { _trace, ...cleanParams } = params;
    const currentStep = this.stepIndex++;
    const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
    const spanId = uuid();
    const parentSpanId = getActiveSpanId();
    const start = Date.now();

    if (!this.client.messages.stream) {
      throw new Error('[trace-ai] This Anthropic client does not support streaming.');
    }
    const messageStream = this.client.messages.stream(cleanParams as MessageCreateParamsNonStreaming);

    messageStream.finalMessage().then((response) => {
      const latency_ms    = Date.now() - start;
      const input_tokens  = response.usage?.input_tokens  ?? 0;
      const output_tokens = response.usage?.output_tokens ?? 0;
      const total_tokens  = input_tokens + output_tokens;
      const model         = response.model ?? cleanParams.model;
      this.tracer.ingest({
        run_id: this.runId,
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
      this.tracer.ingest({
        run_id: this.runId,
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
  }
}
