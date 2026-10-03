export interface SelectionSummary {
  count: number;
  sum: number;
  average: number;
  min: number;
  max: number;
}

// Stats over the numeric cells in a selection, like the status bar in
// Excel/Sheets. Returns null when there's nothing numeric to summarize.
export function summarize(values: number[]): SelectionSummary | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const sum = finite.reduce((total, v) => total + v, 0);
  return {
    count: finite.length,
    sum,
    average: sum / finite.length,
    min: Math.min(...finite),
    max: Math.max(...finite),
  };
}
