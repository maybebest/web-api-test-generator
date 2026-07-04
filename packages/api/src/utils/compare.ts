// Locale-INVARIANT string comparator for every sort that shapes generated output.
//
// String.prototype.localeCompare follows the machine's default ICU locale, so two developers (or a
// developer and CI) can produce differently-ordered "deterministic" output — query key order, test
// grouping, fixture order, and the JSON.stringify(query) fed into endpoint-id hashes would all
// drift, breaking the regenerate-and-diff drift check for everyone else. Plain code-point
// comparison is stable on every machine.
export function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
