import type Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { Tracer } from '../tracer';
import { getCost, getContextWindow } from '../cost';

type AnthropicClient = InstanceType<typeof Anthropic>;

// Augment the params type to allow _trace without breaking the real SDK
type TracedMessageParams = MessageCreateParamsNonStreaming & {
  _trace?: { stepName?: string };
};

export function wrapAnthropic(client: AnthropicClient, tracer: Tracer): AnthropicClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'messages') return Reflect.get(target, prop, receiver);

      return new Proxy(target.messages, {
        get(msgTarget, msgProp, msgReceiver) {
          if (msgProp !== 'create') return Reflect.get(msgTarget, msgProp, msgReceiver);

          return async function tracedCreate(params: TracedMessageParams) {
            const { _trace, ...cleanParams } = params;
            const stepName = _trace?.stepName ?? 'anthropic.messages.create';
            const start = Date.now();

            try {
              const response = await (msgTarget.create as Function).call(
                msgTarget,
                cleanParams as MessageCreateParamsNonStreaming,
              );

              const latency_ms = Date.now() - start;
              const input_tokens = response.usage?.input_tokens ?? 0;
              const output_tokens = response.usage?.output_tokens ?? 0;
              const reasoning_tokens = (response.usage as any)?.thinking_tokens;
              const total_tokens = input_tokens + output_tokens + (reasoning_tokens ?? 0);
              const model = response.model ?? cleanParams.model;
              const contextWindow = getContextWindow(model);

              tracer.ingest({
                run_id: tracer.runId,
                step_name: stepName,
                model,
                prompt: JSON.stringify(cleanParams.messages),
                input_tokens,
                output_tokens,
                reasoning_tokens,
                total_tokens,
                latency_ms,
                cost_usd: getCost(model, input_tokens, output_tokens),
                context_limit: contextWindow,
                context_utilization: contextWindow
                  ? total_tokens / contextWindow
                  : undefined,
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
                prompt: JSON.stringify(cleanParams.messages),
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
          };
        },
      });
    },
  });
}
