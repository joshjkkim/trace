import { AsyncLocalStorage } from 'node:async_hooks';

interface SpanContext {
  spanId: string;
}

const spanStorage = new AsyncLocalStorage<SpanContext>();

export function getActiveSpanId(): string | null {
  return spanStorage.getStore()?.spanId ?? null;
}

export function runWithSpan<T>(spanId: string, fn: () => Promise<T>): Promise<T> {
  return spanStorage.run({ spanId }, fn);
}
