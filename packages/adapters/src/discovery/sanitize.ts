const AUTHORIZATION = /\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi;
const KEY_VALUE = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[=:]\s*[^\s,;]+/gi;
const URL_QUERY = /(https?:\/\/[^\s?#]+)(?:\?[^\s#]*)?(?:#[^\s]*)?/gi;

/** Truncate text without splitting a UTF-8 code point. */
export function boundedText(value: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return "";
  const bytes = Buffer.from(value);
  if (bytes.length <= maxBytes) return value;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.floor(maxBytes)));
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function stripTerminalControls(value: string): string {
  let clean = "";
  let escapeState: "none" | "start" | "csi" | "osc" = "none";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (escapeState === "start") {
      if (character === "[") escapeState = "csi";
      else if (character === "]") escapeState = "osc";
      else escapeState = "none";
      continue;
    }
    if (escapeState === "csi") {
      if (code >= 64 && code <= 126) escapeState = "none";
      continue;
    }
    if (escapeState === "osc") {
      if (code === 7) escapeState = "none";
      else if (code === 27) escapeState = "start";
      continue;
    }
    if (code === 27) {
      escapeState = "start";
      continue;
    }
    if ((code >= 32 && code !== 127) || character === "\n" || character === "\t") clean += character;
  }
  return clean;
}

/** Convert untrusted detector output into bounded text safe for logs and API responses. */
export function sanitizeDiscoveryText(value: string, roots: readonly string[] = []): string {
  let clean = normalizePath(stripTerminalControls(value));
  const normalizedRoots = [...roots]
    .map(normalizePath)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const root of normalizedRoots) clean = clean.replaceAll(root, "<HOME>");
  clean = clean
    .replace(AUTHORIZATION, "$1<REDACTED>")
    .replace(KEY_VALUE, "$1=<REDACTED>")
    .replace(URL_QUERY, "$1?<REDACTED>");
  return boundedText(clean, 2_048);
}
