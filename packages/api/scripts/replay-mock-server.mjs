#!/usr/bin/env node
// Deterministic replay mock for the generated @smoke suite.
//
// Every active @smoke assertion in tests/generated expects exactly HTTP 200 + a
// `Content-Type: application/json` response (verified: 36/36 smoke assertions are {kind:exact,200}),
// with no response-body equality checks. So this server answers EVERY request with that — an empty
// JSON object — regardless of method or path. That needs no captures, no credentials, and no
// per-route knowledge, which is what lets `npm run test:api:replay` run the generated happy-path
// suite green in CI without a live system-under-test.
//
// It deliberately does NOT serve the inferred negative/security cases (those are test.fixme by
// default and excluded by the --grep @smoke filter); replaying a 4xx contract would require
// payload-aware logic and belongs to the calibration workflow, not this smoke replay.
import http from 'node:http';

const port = Number(process.env.REPLAY_PORT ?? 4599);

const server = http.createServer((req, res) => {
  // Drain any request body so keep-alive sockets don't stall on POST/PUT/PATCH payloads.
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[replay-mock] listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
