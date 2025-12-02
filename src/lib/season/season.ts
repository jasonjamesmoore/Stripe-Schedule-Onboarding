// season.ts
// UTC month helpers and seasonal window calculation. Parametric on env for testability.

export function startOfMonthUtcEpoch(year: number, month0: number): number {
  return Math.floor(Date.UTC(year, month0, 1, 0, 0, 0) / 1000);
}

export function nextSeasonWindow(
  refEpoch: number,
  env: Record<string, string | undefined> = process.env
): { start: number; end: number } {
  const startM0 = Number(env.TEST_SEASON_START_MONTH_0 ?? 5); // default Jun
  const endM0 = Number(env.TEST_SEASON_END_MONTH_0 ?? 8);     // default Sep end → Oct 1 (exclusive)

  const ref = new Date(refEpoch * 1000);
  const y = ref.getUTCFullYear();

  const thisStart = startOfMonthUtcEpoch(y, startM0);
  const thisEnd = startOfMonthUtcEpoch(y, endM0);

  if (refEpoch < thisEnd) {
    if (refEpoch < thisStart) return { start: thisStart, end: thisEnd };
  }
  return {
    start: startOfMonthUtcEpoch(y + 1, startM0),
    end:   startOfMonthUtcEpoch(y + 1, endM0),
  };
}
