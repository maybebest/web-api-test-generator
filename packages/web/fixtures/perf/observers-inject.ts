// Init-script that installs PerformanceObservers for signals that must be watched over the whole
// page lifetime (they can't be read after the fact): Long Tasks (main-thread blocking > 50ms) and
// Layout Shifts (individual CLS shifts + which nodes moved). Results accumulate on
// self.__PERF_OBS__ and are read at teardown. Injected before navigation, like the web-vitals script.
//
// Written as a plain string (browser JS) so it needs no DOM lib at compile time. Every observer is
// wrapped in try/catch: an engine that doesn't support a given entry type (e.g. firefox has no
// layout-shift/longtask) just yields an empty list instead of throwing. Web-only.
export function buildObserversInitScript(): string {
  return `
(function () {
  var store = (self.__PERF_OBS__ = self.__PERF_OBS__ || { longTasks: [], layoutShifts: [] });
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        store.longTasks.push({ startMs: Math.round(e.startTime), durationMs: Math.round(e.duration) });
      });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        if (e.hadRecentInput) return;
        var sources = [];
        (e.sources || []).forEach(function (s) {
          var n = s.node;
          if (n && n.tagName) {
            var sel = n.tagName.toLowerCase();
            if (n.id) { sel += '#' + n.id; }
            else if (typeof n.className === 'string' && n.className.trim()) {
              sel += '.' + n.className.trim().split(/\\s+/).slice(0, 3).join('.');
            }
            sources.push(sel);
          }
        });
        store.layoutShifts.push({ value: e.value, sources: sources });
      });
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
})();
`;
}
