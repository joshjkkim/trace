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
  Tracer: () => Tracer
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
function getContextWindow(model) {
  return PRICING[model]?.contextWindow;
}

// src/wrappers/anthropic.ts
function wrapAnthropic(client, tracer) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "messages") return Reflect.get(target, prop, receiver);
      return new Proxy(target.messages, {
        get(msgTarget, msgProp, msgReceiver) {
          if (msgProp !== "create") return Reflect.get(msgTarget, msgProp, msgReceiver);
          return async function tracedCreate(params) {
            const { _trace, ...cleanParams } = params;
            const stepName = _trace?.stepName ?? "anthropic.messages.create";
            const start = Date.now();
            try {
              const response = await msgTarget.create.call(
                msgTarget,
                cleanParams
              );
              const latency_ms = Date.now() - start;
              const input_tokens = response.usage?.input_tokens ?? 0;
              const output_tokens = response.usage?.output_tokens ?? 0;
              const reasoning_tokens = response.usage?.thinking_tokens;
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
                context_utilization: contextWindow ? total_tokens / contextWindow : void 0,
                status: "success"
              });
              return response;
            } catch (err) {
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
                status: "error",
                error: message
              });
              throw err;
            }
          };
        }
      });
    }
  });
}

// src/tracer.ts
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : r & 3 | 8).toString(16);
  });
}
var DEFAULT_API_URL = "https://ingest.trace-ai.com";
var Tracer = class {
  constructor(config) {
    this.apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.runId = config.runId ?? uuid();
  }
  ingest(payload) {
    fetch(`${this.apiUrl}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    }).catch((err) => console.warn("[trace-ai] ingest failed:", err));
  }
  wrapAnthropic(client) {
    return wrapAnthropic(client, this);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Tracer
});
//# sourceMappingURL=index.js.map