const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/**
 * Human-readable file size.
 *
 * Uses 1024 with the short unit names people actually recognise on a file
 * listing. Whole numbers below a kilobyte, one decimal above, because "1.0 KB"
 * reads as noise and "1536 B" reads as a machine talking.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(1)} ${UNITS[unit]}`;
}
