// Self-contained smoke test for /sdk.
// Verifies the built SDK: wraps a (fake) Anthropic client, makes a call,
// and confirms the trace payload is POSTed correctly — no API key, no DB needed.
//
//   npm run build && node smoke-test.mjs

import http from 'node:http';
import { Tracer } from './dist/index.mjs';

const PORT = 8787;
let captured = null;

// 1. Tiny mock ingest server that captures whatever the SDK POSTs.
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    captured = { path: req.url, payload: JSON.parse(body) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ trace_id: 'mock-trace-123' }));
  });
});

await new Promise((r) => server.listen(PORT, r));
console.log(`mock ingest server listening on http://localhost:${PORT}`);

// 2. Point the Tracer at the mock server.
const tracer = new Tracer({
  apiKey: 'test-key',
  apiUrl: `http://localhost:${PORT}`,
});

// 3. Fake Anthropic client — only needs messages.create at runtime.
const fakeAnthropic = {
  messages: {
    create: async (params) => ({
      model: params.model,
      content: [{ type: 'text', text: 'def is_palindrome(s): return s == s[::-1]' }],
      usage: { input_tokens: 42, output_tokens: 17 },
    }),
  },
};

// 4. Wrap it and make a traced call.
const anthropic = tracer.wrapAnthropic(fakeAnthropic);
const res = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Write a palindrome checker.' }],
  _trace: { stepName: 'smoke_test' },
});

// 5. Give the fire-and-forget ingest a moment to land, then assert.
await new Promise((r) => setTimeout(r, 200));
server.close();

console.log('\n--- model response ---');
console.log(res.content[0].text);

console.log('\n--- captured ingest ---');
console.log('POST path:', captured?.path);
console.log(JSON.stringify(captured?.payload, null, 2));

const p = captured?.payload;
const ok =
  captured?.path === '/ingest' &&
  p?.step_name === 'smoke_test' &&
  p?.model === 'claude-sonnet-4-6' &&
  p?.input_tokens === 42 &&
  p?.output_tokens === 17 &&
  p?.total_tokens === 59 &&
  p?.status === 'success' &&
  typeof p?.cost_usd === 'number' &&
  p?.context_limit === 200000;

console.log(`\n${ok ? 'PASS ✅' : 'FAIL ❌'} — SDK ${ok ? 'builds, wraps, traces, and POSTs correctly' : 'did not produce the expected trace'}`);
process.exit(ok ? 0 : 1);
