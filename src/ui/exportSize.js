// Long sides offered for the download, in pixels.
export const OUT_SIZES = [1200, 2000, 3000, 4000];

// What `long` pixels measure on paper at `dpi`.
export function printSize(long, dpi = 300) {
  return `${Math.round((long / dpi) * 2.54)} cm a ${dpi} ppp`;
}
