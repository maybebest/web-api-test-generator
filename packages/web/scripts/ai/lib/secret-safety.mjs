const KNOWN_SECRET_PATTERNS = Object.freeze([
  /\bbearer\s+[a-z0-9._~+\/-]{10,}/i,
  /\bbasic\s+[A-Za-z0-9+/=]{12,}/i,
  /\b(?:password|passwd|pwd)\s*[:=]\s*['"`][^'"`]{4,}/i,
  /\b(?:api[_-]?(?:key|token)|apikey|authorization|auth[_-]?cookie|client[_-]?secret|secret|access[_-]?token|refresh[_-]?token|id[_-]?token|csrf(?:[_-]?token)?|session(?:id)?|token)\s*[:=]\s*['"`][^'"`]{8,}/i,
  /\bgh[opsur]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/
]);

export function shannonEntropy(value) {
  const text = String(value ?? '');
  if (!text) return 0;
  const counts = new Map();
  for (const character of text) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / text.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export function isHighEntropySecretLike(value) {
  const text = String(value ?? '');
  return text.length >= 20
    && !/\s/.test(text)
    && /[A-Z]/.test(text)
    && /[a-z]/.test(text)
    && /\d/.test(text)
    && shannonEntropy(text) >= 4;
}

export function isOpaqueTokenLike(value) {
  const text = String(value ?? '');
  if (/\s/.test(text) || text.length < 26 || !/^[A-Za-z0-9._-]+$/.test(text)) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  return letters >= 3 && digits >= 3 && shannonEntropy(text) >= 3.5;
}

export function hasKnownSecretShape(value) {
  const text = String(value ?? '');
  return KNOWN_SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function containsSecretLikeValue(value) {
  const text = String(value ?? '');
  return hasKnownSecretShape(text) || isHighEntropySecretLike(text) || isOpaqueTokenLike(text);
}

// Provider-bound specs are prose/JSON rather than executable source. Use a
// stricter token sweep there, while avoiding common semantic kebab identifiers
// and filenames that the reviewer intentionally handles with AST context.
export function containsProviderUnsafeSecret(value) {
  const text = String(value ?? '');
  if (hasKnownSecretShape(text)) return true;
  if (/\b(?:password|passwd|pwd|api[_-]?(?:key|token)|authorization|auth[_-]?cookie|token|secret|session(?:id)?|csrf(?:[_-]?token)?)\s*[:=]\s*[^\s,;]{4,}/i.test(text)) {
    return true;
  }
  const candidates = text.match(/[A-Za-z0-9._-]{20,}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = (candidate.match(/\d/g) ?? []).length;
    return (isHighEntropySecretLike(candidate) && digits >= 3)
      || (isOpaqueTokenLike(candidate) && /^[A-Za-z0-9_]+$/.test(candidate));
  });
}

export function redactSecretMaterial(value) {
  let text = String(value ?? '');
  text = text
    .replace(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/gi, '<redacted>')
    .replace(/\b(authorization|cookie|set-cookie|x-csrf-token)\s*:\s*.*$/gim, '$1: <redacted>')
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]{4,}/gi, '<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted>')
    .replace(/\b(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g, '<redacted>')
    .replace(
      /\b(api[_-]?(?:key|token)|apikey|authorization|auth[_-]?cookie|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|csrf(?:[_-]?token)?|session(?:id)?|token|password|passwd|pwd|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi,
      '$1=<redacted>'
    );
  return text.replace(/[A-Za-z0-9._-]{20,}/g, (candidate) => (
    isHighEntropySecretLike(candidate) || isOpaqueTokenLike(candidate) ? '<redacted>' : candidate
  ));
}
