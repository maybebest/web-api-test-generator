// Builds the page init-script that installs web-vitals observers BEFORE first paint.
//
// web-vitals runs in the browser, so we cannot import it into Node and observe the page. Instead we
// read its prebuilt attribution IIFE bundle from node_modules and prepend it to a small bootstrap
// that funnels each metric (latest value + attribution) into `self.__WEB_VITALS__`. The auto-fixture
// injects the result via `page.addInitScript({ content })` before the app navigates, so observers
// are live for the very first paint of every test — no per-test wiring.
//
// Web-only — must NOT import from packages/api.
import fs from 'node:fs';
import path from 'node:path';

// web-vitals' package `exports` map blocks `./package.json` and `./dist/*`, so resolve the main
// entry (dist/web-vitals.umd.cjs) and swap to the attribution IIFE sitting next to it. Read once
// at process start and cache — the bundle is identical for every test.
let cachedIife: string | undefined;
function readWebVitalsIife(): string {
  if (cachedIife === undefined) {
    const distDir = path.dirname(require.resolve('web-vitals'));
    cachedIife = fs.readFileSync(path.join(distDir, 'web-vitals.attribution.iife.js'), 'utf8');
  }
  return cachedIife;
}

// Runs in the browser, concatenated after the IIFE (which declares a top-level `var webVitals`).
// reportAllChanges:true so a value is still captured if the page unloads mid-test; last write wins.
// Written as a plain string (not typed TS) so it needs no DOM lib at compile time.
const BOOTSTRAP = `
(function () {
  var wv = (typeof webVitals !== 'undefined' && webVitals) || self.webVitals;
  if (!wv) return;
  var store = (self.__WEB_VITALS__ = self.__WEB_VITALS__ || {});
  var toStr = function (v) { return v === undefined || v === null ? null : String(v); };
  var save = function (m) {
    var a = m.attribution || {};
    store[m.name] = {
      value: m.value,
      rating: m.rating,
      attribution: {
        // web-vitals v5 renamed LCP attribution's element selector to 'target'; keep 'element' as a
        // fallback so an older/newer major still yields a value instead of silent null.
        element: toStr(a.target !== undefined ? a.target : a.element),
        url: toStr(a.url),
        largestShiftTarget: toStr(a.largestShiftTarget),
        interactionTarget: toStr(a.interactionTarget)
      }
    };
  };
  wv.onLCP(save, { reportAllChanges: true });
  wv.onCLS(save, { reportAllChanges: true });
  wv.onINP(save, { reportAllChanges: true });
  wv.onFCP(save, { reportAllChanges: true });
  wv.onTTFB(save);
})();
`;

export function buildWebVitalsInitScript(): string {
  return `${readWebVitalsIife()}\n${BOOTSTRAP}`;
}
