interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  contextWindow: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-8':              { inputPer1M: 15.00,  outputPer1M: 75.00,  contextWindow: 200_000 },
  'claude-opus-4-8-20251101':     { inputPer1M: 15.00,  outputPer1M: 75.00,  contextWindow: 200_000 },
  'claude-sonnet-4-6':            { inputPer1M: 3.00,   outputPer1M: 15.00,  contextWindow: 200_000 },
  'claude-sonnet-4-6-20251001':   { inputPer1M: 3.00,   outputPer1M: 15.00,  contextWindow: 200_000 },
  'claude-haiku-4-5':             { inputPer1M: 0.80,   outputPer1M: 4.00,   contextWindow: 200_000 },
  'claude-haiku-4-5-20251001':    { inputPer1M: 0.80,   outputPer1M: 4.00,   contextWindow: 200_000 },
  'claude-3-5-sonnet-20241022':   { inputPer1M: 3.00,   outputPer1M: 15.00,  contextWindow: 200_000 },
  'claude-3-5-haiku-20241022':    { inputPer1M: 0.80,   outputPer1M: 4.00,   contextWindow: 200_000 },
  'claude-3-opus-20240229':       { inputPer1M: 15.00,  outputPer1M: 75.00,  contextWindow: 200_000 },

  // OpenAI
  'gpt-4o':                       { inputPer1M: 2.50,   outputPer1M: 10.00,  contextWindow: 128_000 },
  'gpt-4o-2024-11-20':            { inputPer1M: 2.50,   outputPer1M: 10.00,  contextWindow: 128_000 },
  'gpt-4o-mini':                  { inputPer1M: 0.15,   outputPer1M: 0.60,   contextWindow: 128_000 },
  'gpt-4o-mini-2024-07-18':       { inputPer1M: 0.15,   outputPer1M: 0.60,   contextWindow: 128_000 },
  'gpt-4-turbo':                  { inputPer1M: 10.00,  outputPer1M: 30.00,  contextWindow: 128_000 },
  'gpt-4-turbo-2024-04-09':       { inputPer1M: 10.00,  outputPer1M: 30.00,  contextWindow: 128_000 },
  'gpt-4':                        { inputPer1M: 30.00,  outputPer1M: 60.00,  contextWindow: 8_192   },
  'gpt-3.5-turbo':                { inputPer1M: 0.50,   outputPer1M: 1.50,   contextWindow: 16_385  },
  'o1':                           { inputPer1M: 15.00,  outputPer1M: 60.00,  contextWindow: 200_000 },
  'o1-mini':                      { inputPer1M: 1.10,   outputPer1M: 4.40,   contextWindow: 128_000 },
  'o3-mini':                      { inputPer1M: 1.10,   outputPer1M: 4.40,   contextWindow: 200_000 },
};

export function getCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.inputPer1M +
         (outputTokens / 1_000_000) * pricing.outputPer1M;
}

export function getContextWindow(model: string): number | undefined {
  return PRICING[model]?.contextWindow;
}