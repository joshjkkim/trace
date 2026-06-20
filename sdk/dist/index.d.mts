import Anthropic from '@anthropic-ai/sdk';

interface TraceConfig {
    apiKey: string;
    runId?: string;
    /** Override the ingest endpoint. Defaults to trace-ai's servers. For local dev only. */
    apiUrl?: string;
}
interface TracePayload {
    run_id: string;
    step_name: string;
    model: string;
    prompt: string;
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
    total_tokens: number;
    latency_ms: number;
    cost_usd?: number;
    context_limit?: number;
    context_utilization?: number;
    status: 'success' | 'error';
    error?: string;
}

declare class Tracer {
    private readonly apiUrl;
    private readonly apiKey;
    readonly runId: string;
    constructor(config: TraceConfig);
    ingest(payload: TracePayload): void;
    wrapAnthropic(client: InstanceType<typeof Anthropic>): InstanceType<typeof Anthropic>;
}

export { type TraceConfig, type TracePayload, Tracer };
