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

// ---------------------------------------------------------------------------
// Complex DOM stress fixtures (additive benchmark surfaces).
// Deterministic: all data is generated from fixed arrays and index math at
// module load; every client-side delay is a fixed constant.
// ---------------------------------------------------------------------------

const complexStyles = `
  .cx-wide { width: min(96vw, 80rem); margin: 1.5rem auto; }
  .cx-layout { display: grid; grid-template-columns: 260px 1fr; gap: 1.5rem; align-items: start; }
  .cx-panel { background: #fff; border: 1px solid #c9d3e5; border-radius: 12px; padding: 1.25rem; }
  .sticky-bar { position: sticky; top: 0; z-index: 40; background: #0f2038; color: #fff; padding: .55rem 1.25rem; display: flex; gap: 1rem; align-items: center; }
  .sticky-bar strong { font-size: .95rem; }
  .sticky-bar .badge { background: #155eef; border-radius: 999px; padding: .1rem .6rem; font-size: .8rem; font-weight: 800; }
  .breadcrumbs ol { display: flex; gap: .5rem; list-style: none; margin: .8rem 0; padding: 0; font-size: .85rem; }
  .breadcrumbs li + li::before { content: '/'; margin-right: .5rem; color: #6f7d94; }
  .nest { padding-left: 2px; border-left: 1px dotted #dfe6f2; }
  .product-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .8rem; margin: .8rem 0 1.4rem; }
  .product-card { border: 1px solid #c9d3e5; border-radius: 10px; padding: .8rem; background: #fff; display: grid; gap: .35rem; }
  .product-card h3 { margin: 0; font-size: .95rem; }
  .product-card .price { font-weight: 800; margin: 0; }
  .product-card .flag { margin: 0; font-size: .78rem; color: #8a5300; }
  .product-card .row { display: flex; gap: .4rem; flex-wrap: wrap; }
  .product-card button { padding: .35rem .6rem; font-size: .78rem; }
  .product-card .wishlist { background: #eef2fa; color: #13294b; }
  table.cx-table { border-collapse: collapse; width: 100%; font-size: .85rem; }
  .cx-table th, .cx-table td { border: 1px solid #dfe6f2; padding: .45rem .6rem; text-align: left; }
  .cx-table th button { background: none; color: #13294b; font-weight: 800; padding: 0; width: 100%; text-align: left; }
  .cx-table th[aria-sort="ascending"] button::after { content: ' \\2191'; }
  .cx-table th[aria-sort="descending"] button::after { content: ' \\2193'; }
  .tabs [role="tablist"] { display: flex; gap: .4rem; border-bottom: 2px solid #dfe6f2; }
  .tabs [role="tab"] { background: #eef2fa; color: #13294b; border-radius: 8px 8px 0 0; padding: .5rem .9rem; }
  .tabs [role="tab"][aria-selected="true"] { background: #155eef; color: #fff; }
  .tabs [role="tabpanel"] { padding: .9rem .2rem; }
  .accordion-trigger { width: 100%; text-align: left; background: #eef2fa; color: #13294b; margin-top: .4rem; }
  .accordion-panel { border: 1px solid #dfe6f2; border-top: 0; padding: .7rem .9rem; }
  fieldset { border: 1px solid #c9d3e5; border-radius: 8px; margin: 0 0 .9rem; display: grid; gap: .35rem; }
  fieldset label { font-weight: 400; display: flex; gap: .45rem; align-items: center; }
  select, input[type="date"] { border: 1px solid #6f7d94; border-radius: 8px; font: inherit; padding: .5rem; }
  .combobox-wrap { position: relative; }
  .combobox-wrap [role="listbox"] { position: absolute; inset-inline: 0; top: 100%; z-index: 30; background: #fff; border: 1px solid #6f7d94; border-radius: 0 0 8px 8px; list-style: none; margin: 0; padding: 0; max-height: 11rem; overflow: auto; }
  .combobox-wrap [role="option"] { padding: .4rem .6rem; cursor: pointer; }
  .combobox-wrap [role="option"].active, .combobox-wrap [role="option"]:hover { background: #155eef; color: #fff; }
  #pagination { display: flex; gap: .35rem; margin-top: .8rem; align-items: center; }
  #pagination button[aria-current="page"] { background: #0f2038; }
  .modal-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(15, 32, 56, .55); display: grid; place-items: center; }
  /* display:grid above overrides the UA [hidden] rule, which left an invisible
     full-viewport overlay intercepting every click on the page. Keep the
     backdrop truly hidden until a quick view opens. */
  .modal-backdrop[hidden] { display: none; }
  .modal { background: #fff; border-radius: 14px; padding: 1.4rem; width: min(92vw, 28rem); display: grid; gap: .7rem; }
  #toast-region { position: fixed; right: 1rem; bottom: 1rem; z-index: 80; display: grid; gap: .5rem; }
  .toast { background: #0f2038; color: #fff; border-radius: 10px; padding: .7rem 1rem; font-size: .85rem; box-shadow: 0 10px 24px rgba(0,0,0,.25); }
  .wizard-step[hidden] { display: none; }
  .field-error { color: #b3261e; font-size: .8rem; font-weight: 400; min-height: 1rem; }
  .error-region { color: #b3261e; font-size: .85rem; min-height: 1.2rem; }
  .error-region ul { margin: .3rem 0; padding-left: 1.1rem; }
  .wizard-nav { display: flex; gap: .6rem; margin-top: 1rem; }
  .wizard-nav .secondary { background: #eef2fa; color: #13294b; }
  [contenteditable="true"] { border: 1px dashed #6f7d94; border-radius: 8px; min-height: 4rem; padding: .6rem; font-weight: 400; }
  .spinner { display: inline-block; width: 1.1rem; height: 1.1rem; border: 3px solid #c9d3e5; border-top-color: #155eef; border-radius: 50%; animation: cx-spin .8s linear infinite; vertical-align: middle; margin-right: .5rem; }
  @keyframes cx-spin { to { transform: rotate(360deg); } }
  .feed-item { border: 1px solid #c9d3e5; border-radius: 12px; background: #fff; padding: .9rem 1.1rem; margin-bottom: .8rem; }
  .feed-item.read { border-color: #dfe6f2; background: #fbfcfe; }
  .feed-item header { background: none; color: inherit; padding: 0; display: flex; gap: .6rem; align-items: center; }
  .avatar { width: 2.1rem; height: 2.1rem; border-radius: 50%; background: #155eef; color: #fff; display: grid; place-items: center; font-weight: 800; font-size: .8rem; }
  .chip { display: inline-block; background: #eef2fa; color: #13294b; border-radius: 999px; padding: .12rem .6rem; font-size: .74rem; font-weight: 700; margin-right: .3rem; }
  .comments ul { list-style: none; margin: .3rem 0 .3rem 1.1rem; padding-left: .6rem; border-left: 2px solid #dfe6f2; }
  .comments li { margin: .3rem 0; font-size: .85rem; }
  .comments button, .feed-item .row button { padding: .3rem .6rem; font-size: .78rem; }
  .feed-item .row { display: flex; gap: .5rem; margin-top: .5rem; align-items: center; }
  .tip { position: relative; display: inline-grid; place-items: center; width: 1.3rem; height: 1.3rem; border-radius: 50%; background: #eef2fa; font-size: .75rem; cursor: help; }
  .tip .tooltip { display: none; position: absolute; bottom: 130%; left: 50%; transform: translateX(-50%); background: #0f2038; color: #fff; padding: .35rem .6rem; border-radius: 6px; font-size: .74rem; white-space: nowrap; z-index: 50; }
  .tip:hover > .tooltip, .tip:focus > .tooltip, .tip:focus-within > .tooltip { display: block; }
  .skeleton { border: 1px solid #dfe6f2; border-radius: 12px; padding: .9rem 1.1rem; margin-bottom: .8rem; }
  .skeleton .bar { height: .8rem; border-radius: 4px; background: linear-gradient(90deg, #e7ecf5, #f6f8fc, #e7ecf5); background-size: 200% 100%; animation: cx-shimmer 1.1s linear infinite; margin: .45rem 0; }
  @keyframes cx-shimmer { to { background-position: -200% 0; } }
  .unread-pill { background: #b3261e; color: #fff; border-radius: 999px; padding: .05rem .55rem; font-weight: 800; }
`;

const CX_NAMES = [
  'Aurora Lamp', 'Basalt Mug', 'Cirrus Throw', 'Dune Vase', 'Ember Candle', 'Fjord Clock',
  'Glacier Bowl', 'Harbor Tray', 'Isle Planter', 'Juniper Frame', 'Kelp Coaster', 'Lumen Shade'
];
const CX_CATEGORIES = ['Lighting', 'Kitchen', 'Textiles', 'Decor'];

const cxProducts = Array.from({ length: 24 }, (_, index) => ({
  id: index + 1,
  name: CX_NAMES[index % CX_NAMES.length],
  sku: `SKU-${1000 + index * 7}`,
  category: CX_CATEGORIES[index % CX_CATEGORIES.length],
  price: (12 + ((index * 13) % 80) + 0.99).toFixed(2),
  stock: (index * 11) % 50,
  rating: (3 + ((index * 3) % 20) / 10).toFixed(1),
  updated: `2026-07-${String(1 + (index % 28)).padStart(2, '0')}`
}));

function cxCard(product, withTestIds) {
  const quickviewTestId = withTestIds ? ` data-testid="quickview-${product.id}"` : '';
  const addTestId = withTestIds ? ` data-testid="addcart-${product.id}"` : '';
  return `<article class="product-card">
    <h3>${product.name}</h3>
    <p class="price">&pound;${product.price}</p>
    ${product.stock < 20 ? '<p class="flag">Limited stock</p>' : '<p class="flag">In stock</p>'}
    <div class="row">
      <button type="button" class="quickview" data-name="${product.name}" data-price="&pound;${product.price}"${quickviewTestId}>Quick view</button>
      <button type="button" class="addcart" data-name="${product.name}"${addTestId}>Add to cart</button>
      <button type="button" class="wishlist">&#9825;</button>
    </div>
  </article>`;
}

function cxTableRow(product) {
  return `<tr data-product-id="${product.id}">
    <td>${product.name}</td>
    <td>${product.sku}</td>
    <td>${product.category}</td>
    <td data-value="${product.price}">&pound;${product.price}</td>
    <td data-value="${product.stock}">${product.stock}</td>
    <td data-value="${product.rating}">${product.rating}</td>
    <td>${product.updated}</td>
  </tr>`;
}

const cxDeepNest = (() => {
  let markup = '<span id="deep-leaf" data-depth="12">Deep leaf node</span>';
  for (let depth = 11; depth >= 0; depth -= 1) {
    markup = `<div class="nest" data-depth="${depth}">${markup}</div>`;
  }
  return markup;
})();

const cxTableHeaders = [
  ['Product', 'text'], ['SKU', 'text'], ['Category', 'text'],
  ['Price', 'number'], ['Stock', 'number'], ['Rating', 'number'], ['Updated', 'text']
];

const complexCatalog = layout(
  'Complex catalog',
  `<style>${complexStyles}</style>
  <div class="sticky-bar">
    <strong>Complex catalog</strong>
    <span class="badge" id="basket-count" data-testid="basket-count">0</span>
    <a href="#catalog-table-region" aria-label="Jump to the full product table">View all</a>
  </div>
  <main class="cx-wide">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/">Home</a></li>
        <li><a href="/complex/catalog">Catalogue</a></li>
        <li aria-current="page">Complex catalog</li>
      </ol>
    </nav>
    <h1>Complex catalog</h1>
    <p>Deterministic DOM-complexity stress surface: 24 seeded products, duplicated card structures, and layered widgets.</p>
    <div class="cx-layout">
      <aside class="cx-panel" aria-label="Filters">
        <h2>Filters</h2>
        <form id="filter-form">
          <fieldset>
            <legend>Category</legend>
            ${CX_CATEGORIES.map((category) => `<label><input type="checkbox" name="category" value="${category}"> ${category}</label>`).join('\n            ')}
          </fieldset>
          <fieldset>
            <legend>Availability</legend>
            <label><input type="radio" name="availability" value="any" checked> Any</label>
            <label><input type="radio" name="availability" value="in-stock"> In stock</label>
            <label><input type="radio" name="availability" value="limited"> Limited stock</label>
          </fieldset>
          <label>Sort preset
            <select id="sort-preset" data-testid="sort-preset">
              <option value="relevance">Relevance</option>
              <option value="price-asc">Price low to high</option>
              <option value="price-desc">Price high to low</option>
              <option value="rating">Rating</option>
            </select>
          </label>
          <label>Materials
            <select id="filter-materials" data-testid="filter-materials" multiple size="4">
              <option>Oak</option>
              <option>Steel</option>
              <option>Ceramic</option>
              <option>Linen</option>
              <option>Recycled glass</option>
            </select>
          </label>
          <label for="brand-combobox">Brand</label>
          <div class="combobox-wrap">
            <input id="brand-combobox" data-testid="brand-combobox" role="combobox" autocomplete="off"
              aria-autocomplete="list" aria-expanded="false" aria-controls="brand-listbox" placeholder="Search brands">
            <ul id="brand-listbox" role="listbox" aria-label="Brand suggestions" hidden>
              ${['Arclight', 'Bergfeld', 'Cobalt Works', 'Drift Studio', 'Eastfold', 'Farrow Lane', 'Gale & Sons', 'Hearthway']
                .map((brand, index) => `<li id="brand-option-${index + 1}" role="option">${brand}</li>`).join('\n              ')}
            </ul>
          </div>
          <p id="filter-status" role="status" data-testid="filter-status">Filters applied: 0 active</p>
          <button type="button" id="apply-filters" aria-label="Apply catalog filters">Apply</button>
        </form>
        ${cxDeepNest}
      </aside>
      <section aria-label="Catalog content">
        <section aria-labelledby="featured-heading">
          <h2 id="featured-heading">Featured products</h2>
          <div class="product-grid" data-testid="featured-grid">
            ${cxProducts.slice(0, 8).map((product) => cxCard(product, true)).join('\n            ')}
          </div>
        </section>
        <section aria-labelledby="clearance-heading">
          <h2 id="clearance-heading">Clearance corner</h2>
          <div class="product-grid">
            ${cxProducts.slice(8, 16).map((product) => cxCard(product, false)).join('\n            ')}
          </div>
        </section>
        <section class="tabs" id="catalog-tabs" aria-label="Catalog information">
          <div role="tablist" aria-label="Catalog information tabs">
            <button type="button" role="tab" id="tab-overview" aria-controls="panel-overview" aria-selected="true" tabindex="0">Overview</button>
            <button type="button" role="tab" id="tab-specs" aria-controls="panel-specs" aria-selected="false" tabindex="-1">Specifications</button>
            <button type="button" role="tab" id="tab-reviews" aria-controls="panel-reviews" aria-selected="false" tabindex="-1">Reviews</button>
          </div>
          <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
            <p>Every product in this catalog is seeded from a deterministic table of 24 entries.</p>
            <h3>Buying guides</h3>
            <button type="button" class="accordion-trigger" aria-expanded="false" aria-controls="acc-materials">Materials guide</button>
            <div class="accordion-panel" id="acc-materials" hidden>
              <p>Oak and steel dominate the range; ceramics appear in the kitchen line.</p>
              <button type="button" class="accordion-trigger" aria-expanded="false" aria-controls="acc-materials-care">Care instructions</button>
              <div class="accordion-panel" id="acc-materials-care" hidden>
                <p>Wipe with a dry cloth. Never machine-wash the linen throws.</p>
              </div>
            </div>
            <button type="button" class="accordion-trigger" aria-expanded="false" aria-controls="acc-shipping">Shipping guide</button>
            <div class="accordion-panel" id="acc-shipping" hidden>
              <p>Orders dispatch in a fixed two-day window in this fixture.</p>
            </div>
          </div>
          <div role="tabpanel" id="panel-specs" aria-labelledby="tab-specs" hidden>
            <p>Specification sheets are generated per SKU from the same seed.</p>
          </div>
          <div role="tabpanel" id="panel-reviews" aria-labelledby="tab-reviews" hidden>
            <p>Reviews are static fixture copy with a stable average of 4.1.</p>
          </div>
        </section>
        <section id="catalog-table-region" aria-labelledby="table-heading">
          <h2 id="table-heading">All products</h2>
          <p id="page-indicator" data-testid="page-indicator">Page 1 of 3</p>
          <table class="cx-table" id="catalog-table">
            <thead>
              <tr>
                ${cxTableHeaders.map(([label, type]) => `<th scope="col" aria-sort="none" data-type="${type}"><button type="button" data-testid="sort-${label.toLowerCase()}">${label}</button></th>`).join('\n                ')}
              </tr>
            </thead>
            <tbody>
              ${cxProducts.map((product) => cxTableRow(product)).join('\n              ')}
            </tbody>
          </table>
          <nav id="pagination" aria-label="Catalog pagination">
            <button type="button" id="page-prev" aria-label="Go to previous page">Prev</button>
            <button type="button" data-page="1" data-testid="page-1" aria-current="page">1</button>
            <button type="button" data-page="2" data-testid="page-2">2</button>
            <button type="button" data-page="3" data-testid="page-3">3</button>
            <button type="button" id="page-next" data-testid="page-next" aria-label="Go to next page">Next</button>
          </nav>
        </section>
      </section>
    </div>
  </main>
  <div class="modal-backdrop" id="quickview-modal" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="quickview-title">
      <h2 id="quickview-title">Product</h2>
      <p id="quickview-price">&pound;0.00</p>
      <p>Quick view renders the same deterministic copy for every product.</p>
      <div class="row" style="display:flex;gap:.6rem;">
        <button type="button" id="modal-add">Add to cart</button>
        <button type="button" id="modal-close" data-testid="modal-close">Close</button>
      </div>
    </div>
  </div>
  <div id="toast-region" role="status" aria-live="polite"></div>
  <script>
    (() => {
      const $ = (selector, root) => (root || document).querySelector(selector);
      const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

      const toastRegion = $('#toast-region');
      function toast(message) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = message;
        toastRegion.appendChild(el);
        setTimeout(() => el.remove(), 1200);
      }

      let basketCount = 0;
      function bumpBasket() {
        basketCount += 1;
        $('#basket-count').textContent = String(basketCount);
      }

      // Sortable table + pagination
      const table = $('#catalog-table');
      const tbody = table.tBodies[0];
      let rows = $$('tr', tbody);
      const pageSize = 10;
      const pageCount = Math.ceil(rows.length / pageSize);
      let page = 1;
      function repaint() {
        rows.forEach((row, index) => {
          tbody.appendChild(row);
          row.hidden = index < (page - 1) * pageSize || index >= page * pageSize;
        });
        $$('#pagination button[data-page]').forEach((button) => {
          if (Number(button.dataset.page) === page) button.setAttribute('aria-current', 'page');
          else button.removeAttribute('aria-current');
        });
        $('#page-indicator').textContent = 'Page ' + page + ' of ' + pageCount;
      }
      $$('#pagination button[data-page]').forEach((button) => {
        button.addEventListener('click', () => { page = Number(button.dataset.page); repaint(); });
      });
      $('#page-prev').addEventListener('click', () => { page = Math.max(1, page - 1); repaint(); });
      $('#page-next').addEventListener('click', () => { page = Math.min(pageCount, page + 1); repaint(); });

      const headers = $$('th', table);
      headers.forEach((th, columnIndex) => {
        $('button', th).addEventListener('click', () => {
          const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
          headers.forEach((header) => header.setAttribute('aria-sort', 'none'));
          th.setAttribute('aria-sort', direction);
          const numeric = th.dataset.type === 'number';
          const factor = direction === 'ascending' ? 1 : -1;
          rows = rows.slice().sort((a, b) => {
            const cellA = a.children[columnIndex];
            const cellB = b.children[columnIndex];
            const valueA = cellA.dataset.value !== undefined ? cellA.dataset.value : cellA.textContent;
            const valueB = cellB.dataset.value !== undefined ? cellB.dataset.value : cellB.textContent;
            if (numeric) return (Number(valueA) - Number(valueB)) * factor;
            return valueA.localeCompare(valueB) * factor;
          });
          page = 1;
          repaint();
        });
      });
      repaint();

      // Tabs (keyboard accessible)
      const tabs = $$('[role="tab"]', $('#catalog-tabs'));
      function selectTab(tab) {
        tabs.forEach((candidate) => {
          const selected = candidate === tab;
          candidate.setAttribute('aria-selected', String(selected));
          candidate.tabIndex = selected ? 0 : -1;
          $('#' + candidate.getAttribute('aria-controls')).hidden = !selected;
        });
        tab.focus();
      }
      tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', (event) => {
          const targets = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
          if (event.key in targets) {
            event.preventDefault();
            selectTab(tabs[(targets[event.key] + tabs.length) % tabs.length]);
          }
        });
      });

      // Accordion (nested one level)
      $$('.accordion-trigger').forEach((button) => {
        button.addEventListener('click', () => {
          const expanded = button.getAttribute('aria-expanded') === 'true';
          button.setAttribute('aria-expanded', String(!expanded));
          $('#' + button.getAttribute('aria-controls')).hidden = expanded;
        });
      });

      // Combobox with filtering listbox
      const combo = $('#brand-combobox');
      const listbox = $('#brand-listbox');
      const options = $$('[role="option"]', listbox);
      let activeIndex = -1;
      function visibleOptions() { return options.filter((option) => !option.hidden); }
      function setActive(index) {
        activeIndex = index;
        options.forEach((option) => option.classList.remove('active'));
        const active = visibleOptions()[index];
        if (active) {
          active.classList.add('active');
          combo.setAttribute('aria-activedescendant', active.id);
        } else {
          combo.removeAttribute('aria-activedescendant');
        }
      }
      function openList(open) {
        listbox.hidden = !open;
        combo.setAttribute('aria-expanded', String(open));
        if (!open) setActive(-1);
      }
      combo.addEventListener('input', () => {
        const value = combo.value.toLowerCase();
        options.forEach((option) => { option.hidden = !option.textContent.toLowerCase().includes(value); });
        openList(true);
        setActive(-1);
      });
      combo.addEventListener('focus', () => openList(true));
      combo.addEventListener('keydown', (event) => {
        const visible = visibleOptions();
        if (event.key === 'ArrowDown') { event.preventDefault(); openList(true); setActive(Math.min(activeIndex + 1, visible.length - 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(activeIndex - 1, 0)); }
        else if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); combo.value = visible[activeIndex].textContent; openList(false); }
        else if (event.key === 'Escape') { openList(false); }
      });
      options.forEach((option) => option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        combo.value = option.textContent;
        openList(false);
        toast('Brand selected: ' + option.textContent);
      }));
      document.addEventListener('click', (event) => {
        if (!event.target.closest('.combobox-wrap')) openList(false);
      });

      // Filters
      $('#apply-filters').addEventListener('click', () => {
        const active = $$('#filter-form input:checked').filter((input) => input.name !== 'availability' || input.value !== 'any').length
          + $$('#filter-materials option:checked').length
          + (combo.value.trim() === '' ? 0 : 1);
        $('#filter-status').textContent = 'Filters applied: ' + active + ' active';
        toast('Filters applied');
      });

      // Modal with focus trap
      const modal = $('#quickview-modal');
      let opener = null;
      function closeModal() {
        modal.hidden = true;
        if (opener) opener.focus();
      }
      $$('.quickview').forEach((button) => button.addEventListener('click', () => {
        opener = button;
        $('#quickview-title').textContent = button.dataset.name;
        $('#quickview-price').textContent = button.dataset.price;
        modal.hidden = false;
        $('#modal-close').focus();
      }));
      $('#modal-close').addEventListener('click', closeModal);
      $('#modal-add').addEventListener('click', () => {
        bumpBasket();
        toast('Added ' + $('#quickview-title').textContent + ' to basket');
        closeModal();
      });
      modal.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
        if (event.key === 'Tab') {
          const focusables = $$('button', modal);
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      });

      // Card actions
      $$('.addcart').forEach((button) => button.addEventListener('click', () => {
        bumpBasket();
        toast('Added ' + button.dataset.name + ' to basket');
      }));
      $$('.wishlist').forEach((button) => button.addEventListener('click', () => toast('Saved to wishlist')));
    })();
  </script>`
);

const complexWizard = layout(
  'Account setup wizard',
  `<style>${complexStyles}</style>
  <main>
    <section class="card" aria-labelledby="wizard-heading">
      <p class="eyebrow">Complex fixture</p>
      <h1 id="wizard-heading">Account setup wizard</h1>
      <p id="wizard-progress" data-testid="wizard-progress">Step 1 of 3</p>
      <div id="wizard-errors" class="error-region" role="alert"></div>
      <form id="wizard-form" novalidate>
        <fieldset id="step-1" class="wizard-step">
          <legend>Step 1: Account details</legend>
          <label style="display:grid">Full name
            <input id="wz-name" data-testid="wizard-name" name="fullName" autocomplete="off">
            <span class="field-error" id="err-name"></span>
          </label>
          <label style="display:grid">Email address
            <input id="wz-email" data-testid="wizard-email" name="email" type="email" autocomplete="off">
            <span class="field-error" id="err-email"></span>
          </label>
          <label style="display:grid">Password
            <input id="wz-password" data-testid="wizard-password" name="password" type="password" autocomplete="new-password">
            <span class="field-error" id="err-password"></span>
          </label>
        </fieldset>
        <fieldset id="step-2" class="wizard-step" hidden>
          <legend>Step 2: Workspace preferences</legend>
          <label style="display:grid">Plan
            <select id="wz-plan" data-testid="wizard-plan" name="plan">
              <option value="">Choose a plan</option>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </select>
          </label>
          <div id="dynamic-business" hidden>
            <label style="display:grid">Company name
              <input id="wz-company" name="company" autocomplete="off">
            </label>
            <input id="wz-vat" name="vat" placeholder="VAT number" autocomplete="off">
          </div>
          <div id="dynamic-personal" hidden>
            <label style="display:grid">How did you hear about us?
              <select id="wz-referral" name="referral">
                <option value="">Select a source</option>
                <option value="friend">A friend</option>
                <option value="search">Web search</option>
                <option value="podcast">Podcast</option>
              </select>
            </label>
          </div>
          <label style="display:grid">Start date
            <input id="wz-date" type="date" name="startDate">
          </label>
          <label style="display:grid">Team size
            <input id="wz-team" type="range" name="teamSize" min="1" max="50" value="5">
            <output id="team-output" for="wz-team">5</output>
          </label>
          <p id="notes-label" style="font-weight:700;margin:.4rem 0 .2rem">Onboarding notes</p>
          <div id="wz-notes" data-testid="wizard-notes" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="notes-label"></div>
        </fieldset>
        <fieldset id="step-3" class="wizard-step" hidden>
          <legend>Step 3: Review and confirm</legend>
          <dl id="review-summary" data-testid="review-summary"></dl>
          <label><input type="checkbox" id="wz-consent"> I confirm the details above are correct</label>
        </fieldset>
        <div class="wizard-nav">
          <button type="button" id="wz-back" class="secondary" disabled>Back</button>
          <button type="button" id="wz-next" disabled>Next</button>
          <button type="submit" id="wz-submit" data-testid="wizard-submit" hidden disabled>Create account</button>
        </div>
      </form>
      <p id="wz-busy" role="status" hidden><span class="spinner"></span>Submitting your application&hellip;</p>
      <section id="wz-success" data-testid="wizard-success" hidden aria-live="polite">
        <h2>Application received</h2>
        <p>Your workspace request is queued for provisioning.</p>
        <p>Confirmation code: <strong id="confirmation-code" data-testid="confirmation-code"></strong></p>
      </section>
    </section>
  </main>
  <script>
    (() => {
      const $ = (selector) => document.querySelector(selector);
      let step = 1;
      const state = {};

      const validators = {
        name: () => {
          const value = $('#wz-name').value.trim();
          return value.length >= 2 ? '' : 'Full name must contain at least 2 characters.';
        },
        email: () => {
          const value = $('#wz-email').value.trim();
          return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value) ? '' : 'Enter a valid email address.';
        },
        password: () => {
          const value = $('#wz-password').value;
          if (value.length < 8) return 'Password must contain at least 8 characters.';
          if (!/\\d/.test(value)) return 'Password must contain a number.';
          return '';
        }
      };

      function renderErrors() {
        const messages = Object.keys(validators)
          .map((key) => ({ key, message: validators[key]() }))
          .filter((entry) => entry.message !== '' && (state.touched || {})[entry.key]);
        const region = $('#wizard-errors');
        region.innerHTML = messages.length === 0
          ? ''
          : '<ul>' + messages.map((entry) => '<li>' + entry.message + '</li>').join('') + '</ul>';
      }

      function validateField(key) {
        state.touched = state.touched || {};
        state.touched[key] = true;
        $('#err-' + key).textContent = validators[key]();
        renderErrors();
      }

      function step1Valid() {
        return Object.keys(validators).every((key) => validators[key]() === '');
      }
      function step2Valid() {
        return $('#wz-plan').value !== '' && $('#wz-date').value !== '';
      }
      function refreshNav() {
        const next = $('#wz-next');
        if (step === 1) next.disabled = !step1Valid();
        else if (step === 2) next.disabled = !step2Valid();
        $('#wz-back').disabled = step === 1;
        next.hidden = step === 3;
        const submit = $('#wz-submit');
        submit.hidden = step !== 3;
        submit.disabled = !$('#wz-consent').checked;
      }

      ['name', 'email', 'password'].forEach((key) => {
        const input = $('#wz-' + key);
        input.addEventListener('blur', () => { validateField(key); refreshNav(); });
        input.addEventListener('input', () => {
          if ((state.touched || {})[key]) validateField(key);
          refreshNav();
        });
      });

      $('#wz-plan').addEventListener('change', () => {
        const plan = $('#wz-plan').value;
        $('#dynamic-business').hidden = plan !== 'business';
        $('#dynamic-personal').hidden = plan !== 'personal';
        refreshNav();
      });
      $('#wz-date').addEventListener('input', refreshNav);
      $('#wz-team').addEventListener('input', () => {
        $('#team-output').textContent = $('#wz-team').value;
      });
      $('#wz-consent').addEventListener('change', refreshNav);

      function collectState() {
        state.fullName = $('#wz-name').value.trim();
        state.email = $('#wz-email').value.trim();
        state.plan = $('#wz-plan').value;
        state.company = $('#wz-company').value.trim();
        state.referral = $('#wz-referral').value;
        state.startDate = $('#wz-date').value;
        state.teamSize = $('#wz-team').value;
        state.notes = $('#wz-notes').textContent.trim();
      }

      function renderReview() {
        collectState();
        const pairs = [
          ['Full name', state.fullName],
          ['Email address', state.email],
          ['Plan', state.plan],
          ['Company', state.plan === 'business' ? state.company : 'n/a'],
          ['Referral', state.plan === 'personal' ? state.referral : 'n/a'],
          ['Start date', state.startDate],
          ['Team size', state.teamSize],
          ['Notes', state.notes === '' ? '(none)' : state.notes]
        ];
        $('#review-summary').innerHTML = pairs
          .map((pair) => '<div><dt>' + pair[0] + '</dt><dd>' + pair[1] + '</dd></div>')
          .join('');
      }

      function goTo(target) {
        step = target;
        $('#step-1').hidden = step !== 1;
        $('#step-2').hidden = step !== 2;
        $('#step-3').hidden = step !== 3;
        $('#wizard-progress').textContent = 'Step ' + step + ' of 3';
        if (step === 3) renderReview();
        refreshNav();
      }

      $('#wz-next').addEventListener('click', () => goTo(Math.min(3, step + 1)));
      $('#wz-back').addEventListener('click', () => goTo(Math.max(1, step - 1)));

      $('#wizard-form').addEventListener('submit', (event) => {
        event.preventDefault();
        collectState();
        $('#wz-submit').disabled = true;
        $('#wz-back').disabled = true;
        $('#wz-busy').hidden = false;
        setTimeout(() => {
          $('#wz-busy').hidden = true;
          $('#wizard-form').hidden = true;
          const code = 'CFX-' + String((state.email.length * 73 + state.fullName.length * 17 + Number(state.teamSize)) % 100000).padStart(5, '0');
          $('#confirmation-code').textContent = code;
          $('#wz-success').hidden = false;
        }, 1100);
      });

      refreshNav();
    })();
  </script>`
);

const complexFeed = layout(
  'Activity feed',
  `<style>${complexStyles}</style>
  <main class="cx-wide" style="max-width:46rem">
    <h1>Activity feed</h1>
    <p>Unread stories: <span class="unread-pill" id="unread-badge" data-testid="unread-badge">0</span></p>
    <div id="feed-list" aria-label="Stories">
      ${Array.from({ length: 4 }, () => `<article class="skeleton" aria-hidden="true"><div class="bar" style="width:40%"></div><div class="bar" style="width:90%"></div><div class="bar" style="width:75%"></div></article>`).join('\n      ')}
    </div>
    <button type="button" id="load-more" data-testid="feed-load-more" disabled>Load more stories</button>
  </main>
  <div id="toast-region" role="status" aria-live="polite"></div>
  <script>
    (() => {
      const $ = (selector, root) => (root || document).querySelector(selector);

      const AUTHORS = ['Ada Nystrom', 'Bram Okafor', 'Ines Castell', 'Juno Marsh', 'Kofi Ellery'];
      const TOPICS = [
        'Nightly pipeline finished in a fixed window',
        'Design tokens refreshed for the fixture theme',
        'Deterministic seed rotated for catalog data',
        'Accessibility sweep logged three follow-ups',
        'Recorder captured a clean checkout session'
      ];
      const TAG_SETS = [['release', 'infra'], ['design', 'qa'], ['infra', 'qa'], ['release', 'design'], ['qa', 'release']];
      const TOTAL = 25;
      const BATCH = 5;
      let rendered = 0;
      let unread = 0;

      function initials(name) {
        return name.split(' ').map((part) => part[0]).join('');
      }

      function commentBranch(itemIndex, prefix, depth, maxDepth) {
        let html = '<ul>';
        const count = depth === 1 ? 2 : 1;
        for (let i = 1; i <= count; i += 1) {
          const id = prefix + '-' + i;
          const hasChildren = depth < maxDepth && i === 1;
          html += '<li><span class="comment-body">Comment ' + id + ' on story ' + (itemIndex + 1) + '</span>';
          if (hasChildren) {
            const branchId = 'branch-' + itemIndex + '-' + id;
            html += ' <button type="button" class="branch-toggle" aria-expanded="true" aria-controls="' + branchId + '">Toggle replies</button>';
            html += '<div id="' + branchId + '">' + commentBranch(itemIndex, id, depth + 1, maxDepth) + '</div>';
          }
          html += '</li>';
        }
        return html + '</ul>';
      }

      function buildItem(index) {
        const author = AUTHORS[index % AUTHORS.length];
        const topic = TOPICS[index % TOPICS.length];
        const tags = TAG_SETS[index % TAG_SETS.length];
        const article = document.createElement('article');
        article.className = 'feed-item';
        article.dataset.testid = 'feed-item-' + (index + 1);
        article.setAttribute('data-testid', 'feed-item-' + (index + 1));
        article.innerHTML =
          '<header>' +
            '<div class="avatar">' + initials(author) + '</div>' +
            '<div><strong>' + author + '</strong> <span class="story-time">' + (2 + (index % 9)) + 'h ago</span></div>' +
            '<span class="tip" tabindex="0" aria-describedby="tip-' + (index + 1) + '">&#9432;' +
              '<span class="tooltip" role="tooltip" id="tip-' + (index + 1) + '">Story ' + (index + 1) + ' is deterministic fixture data</span>' +
            '</span>' +
          '</header>' +
          '<h3>' + topic + '</h3>' +
          '<p>' + tags.map((tag) => '<span class="chip">' + tag + '</span>').join('') + '</p>' +
          '<div class="row">' +
            '<button type="button" class="expand-details" aria-expanded="false">Details</button>' +
            '<button type="button" class="toggle-comments" aria-expanded="false">Comments</button>' +
          '</div>' +
          '<div class="details" hidden><dl>' +
            '<div><dt>Story id</dt><dd>STORY-' + String(index + 1).padStart(3, '0') + '</dd></div>' +
            '<div><dt>Impressions</dt><dd>' + (120 + index * 7) + '</dd></div>' +
            '<div><dt>Status</dt><dd>' + (index % 2 === 0 ? 'Stable' : 'Monitoring') + '</dd></div>' +
          '</dl></div>' +
          '<div class="comments" hidden>' + commentBranch(index, 'C', 1, 5) + '</div>';

        const details = $('.details', article);
        const comments = $('.comments', article);
        $('.expand-details', article).addEventListener('click', (event) => {
          const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
          event.currentTarget.setAttribute('aria-expanded', String(!expanded));
          details.hidden = expanded;
          if (!expanded && !article.classList.contains('read')) {
            article.classList.add('read');
            unread = Math.max(0, unread - 1);
            $('#unread-badge').textContent = String(unread);
          }
        });
        $('.toggle-comments', article).addEventListener('click', (event) => {
          const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
          event.currentTarget.setAttribute('aria-expanded', String(!expanded));
          comments.hidden = expanded;
        });
        Array.from(article.querySelectorAll('.branch-toggle')).forEach((toggle) => {
          toggle.addEventListener('click', () => {
            const expanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!expanded));
            document.getElementById(toggle.getAttribute('aria-controls')).hidden = expanded;
          });
        });
        return article;
      }

      function appendBatch(count) {
        const list = $('#feed-list');
        for (let i = 0; i < count && rendered < TOTAL; i += 1) {
          list.appendChild(buildItem(rendered));
          rendered += 1;
          unread += 1;
        }
        $('#unread-badge').textContent = String(unread);
        const loadMore = $('#load-more');
        if (rendered >= TOTAL) {
          loadMore.disabled = true;
          loadMore.textContent = 'All stories loaded';
        } else {
          loadMore.disabled = false;
          loadMore.textContent = 'Load more stories';
        }
      }

      setTimeout(() => {
        const list = $('#feed-list');
        list.innerHTML = '';
        appendBatch(15);
      }, 600);

      $('#load-more').addEventListener('click', () => {
        const loadMore = $('#load-more');
        loadMore.disabled = true;
        loadMore.textContent = 'Loading\\u2026';
        setTimeout(() => appendBatch(BATCH), 500);
      });
    })();
  </script>`
);

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (url.pathname === '/__health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end('{"status":"ok"}\n');
    return;
  }

  const routes = {
    '/': home,
    '/recorded-example/checkout': checkout,
    '/complex/catalog': complexCatalog,
    '/complex/wizard': complexWizard,
    '/complex/feed': complexFeed
  };
  const page = Object.prototype.hasOwnProperty.call(routes, url.pathname) ? routes[url.pathname] : undefined;
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
