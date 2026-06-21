import { MessageCreateParamsNonStreaming, Message } from '@anthropic-ai/sdk/resources/messages';

interface TraceOptions {
    stepName?: string;
}
interface TraceConfig {
    apiKey: string;
    runId?: string;
    /** Override the ingest endpoint. Defaults to trace-ai's servers. For local dev only. */
    apiUrl?: string;
}
interface TracePayload {
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
}
interface AnthropicClientLike {
    messages: {
        create(params: MessageCreateParamsNonStreaming, options?: unknown): Promise<Message>;
    };
}
type TracedMessageParams = MessageCreateParamsNonStreaming & {
    _trace?: TraceOptions;
};

declare class TracedRun {
    private readonly client;
    private readonly tracer;
    readonly runId: string;
    readonly messages: {
        create(params: TracedMessageParams): Promise<Message>;
    };
    private stepIndex;
    constructor(client: AnthropicClientLike, tracer: Tracer);
    private _create;
}

interface TracedAnthropicMessages {
    create(params: TracedMessageParams): Promise<Message>;
}
interface TracedAnthropic {
    messages: TracedAnthropicMessages;
    /** Start a new run — fresh run_id, step_index resets to 0. */
    run(): TracedRun;
}

declare class Tracer {
    private readonly apiUrl;
    private readonly apiKey;
    readonly runId: string;
    constructor(config: TraceConfig);
    ingest(payload: TracePayload): Promise<string | null>;
    wrapAnthropic(client: AnthropicClientLike): TracedAnthropic;
}

declare function getCost(model: string, inputTokens: number, outputTokens: number): number;

export { type AnthropicClientLike, type TraceConfig, type TraceOptions, type TracePayload, type TracedAnthropic, type TracedMessageParams, TracedRun, Tracer, getCost };
