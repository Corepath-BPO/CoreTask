/**
 * "Chrome on Windows" from a User-Agent header, for the session list.
 *
 * Deliberately small: the list only has to let someone recognise their own
 * devices, so the common browsers and systems are named and anything else
 * falls back to a plain "Unknown browser". Order matters — Edge and Opera
 * both claim to be Chrome, and Chrome claims to be Safari.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';

  const browser =
    match(userAgent, [
      [/Edg(?:e|A|iOS)?\//, 'Edge'],
      [/OPR\/|Opera/, 'Opera'],
      [/Firefox\/|FxiOS\//, 'Firefox'],
      [/SamsungBrowser\//, 'Samsung Internet'],
      [/Chrome\/|CriOS\//, 'Chrome'],
      [/Safari\//, 'Safari'],
    ]) ?? 'Unknown browser';

  const system = match(userAgent, [
    [/iPhone/, 'iPhone'],
    [/iPad/, 'iPad'],
    [/Android/, 'Android'],
    [/Windows/, 'Windows'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
  ]);

  return system ? `${browser} on ${system}` : browser;
}

function match(value: string, rules: [RegExp, string][]): string | null {
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}
