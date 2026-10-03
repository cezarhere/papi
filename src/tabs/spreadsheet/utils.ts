// Converts a 0-based column index to spreadsheet-style letters (0 -> "A",
// 25 -> "Z", 26 -> "AA"). Correct past 26 columns too (the grid is A-Z today).
export function columnLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
