#!/usr/bin/env node

import http from 'node:http';

const host = process.env.LOCAL_FIXTURE_HOST ?? '127.0.0.1';
const port = Number(process.env.LOCAL_FIXTURE_PORT ?? '3000');

const styles = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f7fb; color: #172033; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; }
  header { background: #13294b; color: #fff; padding: 1rem 1.5rem; }
  nav { display: flex; align-items: center; gap: 1rem; max-width: 64rem; margin: 0 auto; }
  nav a { color: #fff; font-weight: 700; }
  main { width: min(92vw, 44rem); margin: 3rem auto; }
  .card { background: #fff; border: 1px solid #c9d3e5; border-radius: 16px; box-shadow: 0 14px 34px rgba(19, 41, 75, .10); padding: 2rem; }
  h1, h2 { line-height: 1.15; }
  p { line-height: 1.6; }
  form { display: grid; gap: 1rem; margin-top: 1.5rem; }
  label { display: grid; gap: .4rem; font-weight: 700; }
  input { border: 1px solid #6f7d94; border-radius: 8px; font: inherit; padding: .75rem; }
  button { width: fit-content; border: 0; border-radius: 8px; background: #155eef; color: #fff; cursor: pointer; font: inherit; font-weight: 800; padding: .75rem 1.1rem; }
  button:focus-visible, a:focus-visible, input:focus-visible { outline: 3px solid #ffbf47; outline-offset: 3px; }
  .eyebrow { color: #155eef; font-size: .8rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .status { border-left: 4px solid #2e7d32; background: #edf8ee; padding: .8rem 1rem; }
`;

function layout(title, body) {
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>${styles}</style>
  </head>
  <body>
    <header>
      <nav aria-label="Fixture navigation">
        <strong>Web test fixture</strong>
        <a href="/">Home</a>
        <a href="/recorded-example/checkout">Checkout</a>
      </nav>
    </header>
    ${body}
  </body>
</html>`;
}

const home = layout(
  'Deterministic local fixture',
  `<main>
    <article class="card" data-testid="fixture-card">
      <p class="eyebrow">Local quality gate</p>
      <h1>Deterministic local fixture</h1>
      <p>This dependency-free page gives smoke, accessibility, visual-contract, and recorder tests a stable target.</p>
      <p class="status" role="status">Fixture ready</p>
      <a href="/recorded-example/checkout">Open the checkout fixture</a>
    </article>
  </main>`
);

const checkout = layout(
  'Checkout',
  `<main>
    <section class="card" aria-labelledby="checkout-heading">
      <p class="eyebrow">Recorder fixture</p>
      <h1 id="checkout-heading">Checkout</h1>
      <form id="checkout-form">
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Full name <input name="fullName" autocomplete="name" required></label>
        <button type="submit">Submit recording</button>
      </form>
      <section id="confirmation" hidden aria-live="polite">
        <h2>Recording submitted</h2>
        <p>Your deterministic fixture submission is complete.</p>
      </section>
    </section>
  </main>
  <script>
    document.querySelector('#checkout-form').addEventListener('submit', (event) => {
      event.preventDefault();
      event.currentTarget.hidden = true;
      document.querySelector('#confirmation').hidden = false;
    });
  </script>`
);

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (url.pathname === '/__health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end('{"status":"ok"}\n');
    return;
  }

  const page = url.pathname === '/' ? home : url.pathname === '/recorded-example/checkout' ? checkout : undefined;
  if (!page) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(page);
});

server.listen(port, host, () => {
  console.log(`Local web fixture listening at http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
