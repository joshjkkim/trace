"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  TracedRun: () => TracedRun,
  Tracer: () => Tracer,
  getCost: () => getCost
});
module.exports = __toCommonJS(index_exports);

// src/cost.ts
var PRICING = {
  // Anthropic
  "claude-opus-4-8": { inputPer1M: 15, outputPer1M: 75, contextWindow: 2e5 },
  "claude-opus-4-8-20251101": { inputPer1M: 15, outputPer1M: 75, contextWindow: 2e5 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15, contextWindow: 2e5 },
  "claude-sonnet-4-6-20251001": { inputPer1M: 3, outputPer1M: 15, contextWindow: 2e5 },
  "claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4, contextWindow: 2e5 },
  "claude-haiku-4-5-20251001": { inputPer1M: 0.8, outputPer1M: 4, contextWindow: 2e5 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3, outputPer1M: 15, contextWindow: 2e5 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.8, outputPer1M: 4, contextWindow: 2e5 },
  "claude-3-opus-20240229": { inputPer1M: 15, outputPer1M: 75, contextWindow: 2e5 }
};
function getCost(model, inputTokens, outputTokens) {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return inputTokens / 1e6 * pricing.inputPer1M + outputTokens / 1e6 * pricing.outputPer1M;
}

// src/context.ts
var import_node_async_hooks = require("async_hooks");
var spanStorage = new import_node_async_hooks.AsyncLocalStorage();
function getActiveSpanId() {
  return spanStorage.getStore()?.spanId ?? null;
}
function runWithSpan(spanId, fn) {
  return spanStorage.run({ spanId }, fn);
}

// src/run.ts
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
function extractOutputCode(response) {
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return text.length > 0 ? text : void 0;
}
var TracedRun = class {
  constructor(client, tracer) {
    this.client = client;
    this.tracer = tracer;
    this.stepIndex = 0;
    this.runId = uuid();
    this.messages = {
      create: (params) => this._create(params),
      stream: (params) => this._stream(params)
    };
  }
  async _create(params) {
    const { _trace, ...cleanParams } = params;
    const currentStep = this.stepIndex++;
    const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
    const spanId = uuid();
    const parentSpanId = getActiveSpanId();
    const start = Date.now();
    try {
      const response = await runWithSpan(
        spanId,
        () => this.client.messages.create(cleanParams)
      );
      const latency_ms = Date.now() - start;
      const input_tokens = response.usage?.input_tokens ?? 0;
      const output_tokens = response.usage?.output_tokens ?? 0;
      const total_tokens = input_tokens + output_tokens;
      const model = response.model ?? cleanParams.model;
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
        parent_span_id: parentSpanId ?? void 0
      });
      return response;
    } catch (err) {
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
        parent_span_id: parentSpanId ?? void 0
      });
      throw err;
    }
  }
  _stream(params) {
    const { _trace, ...cleanParams } = params;
    const currentStep = this.stepIndex++;
    const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
    const spanId = uuid();
    const parentSpanId = getActiveSpanId();
    const start = Date.now();
    if (!this.client.messages.stream) {
      throw new Error("[trace-ai] This Anthropic client does not support streaming.");
    }
    const messageStream = this.client.messages.stream(cleanParams);
    messageStream.finalMessage().then((response) => {
      const latency_ms = Date.now() - start;
      const input_tokens = response.usage?.input_tokens ?? 0;
      const output_tokens = response.usage?.output_tokens ?? 0;
      const total_tokens = input_tokens + output_tokens;
      const model = response.model ?? cleanParams.model;
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
        parent_span_id: parentSpanId ?? void 0
      });
    }).catch((err) => {
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
        parent_span_id: parentSpanId ?? void 0
      });
    });
    return messageStream;
  }
};

// src/wrappers/anthropic.ts
function uuid2() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
function extractOutputCode2(response) {
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return text.length > 0 ? text : void 0;
}
function wrapAnthropic(client, tracer) {
  let stepIndex = 0;
  return {
    messages: {
      async create(params) {
        const { _trace, ...cleanParams } = params;
        const currentStep = stepIndex++;
        const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
        const spanId = uuid2();
        const parentSpanId = getActiveSpanId();
        const start = Date.now();
        try {
          const response = await runWithSpan(
            spanId,
            () => client.messages.create(cleanParams)
          );
          const latency_ms = Date.now() - start;
          const input_tokens = response.usage?.input_tokens ?? 0;
          const output_tokens = response.usage?.output_tokens ?? 0;
          const total_tokens = input_tokens + output_tokens;
          const model = response.model ?? cleanParams.model;
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
            output_code: extractOutputCode2(response),
            span_id: spanId,
            parent_span_id: parentSpanId ?? void 0
          });
          return response;
        } catch (err) {
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
            parent_span_id: parentSpanId ?? void 0
          });
          throw err;
        }
      },
      stream(params) {
        const { _trace, ...cleanParams } = params;
        const currentStep = stepIndex++;
        const stepName = _trace?.stepName ?? `step_${currentStep + 1}`;
        const spanId = uuid2();
        const parentSpanId = getActiveSpanId();
        const start = Date.now();
        if (!client.messages.stream) {
          throw new Error("[trace-ai] This Anthropic client does not support streaming.");
        }
        const messageStream = client.messages.stream(cleanParams);
        messageStream.finalMessage().then((response) => {
          const latency_ms = Date.now() - start;
          const input_tokens = response.usage?.input_tokens ?? 0;
          const output_tokens = response.usage?.output_tokens ?? 0;
          const total_tokens = input_tokens + output_tokens;
          const model = response.model ?? cleanParams.model;
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
            output_code: extractOutputCode2(response),
            span_id: spanId,
            parent_span_id: parentSpanId ?? void 0
          });
        }).catch((err) => {
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
            parent_span_id: parentSpanId ?? void 0
          });
        });
        return messageStream;
      }
    },
    run() {
      return new TracedRun(client, tracer);
    }
  };
}

// src/tracer.ts
function uuid3() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
var DEFAULT_API_URL = "https://trace-production-940c.up.railway.app";
var Tracer = class {
  constructor(config) {
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.runId = config.runId ?? uuid3();
  }
  ingest(payload) {
    return fetch(`${this.apiUrl}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    }).then((res) => res.ok ? res.json() : Promise.reject(res.status)).then((data) => data.trace_id ?? null).catch((err) => {
      console.warn("[trace-ai] ingest failed:", err);
      return null;
    });
  }
  wrapAnthropic(client) {
    return wrapAnthropic(client, this);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TracedRun,
  Tracer,
  getCost
});
//# sourceMappingURL=index.js.map