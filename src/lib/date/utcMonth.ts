// UTC month helpers (epoch seconds)

export function startOfMonthUtcEpoch(year: number, month0: number): number {
  return Math.floor(Date.UTC(year, month0, 1, 0, 0, 0) / 1000);
}

export function nextMonthFirstEpoch(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  return startOfMonthUtcEpoch(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

export function monthStartsBetween(minStart: number, maxEnd: number): number[] {
  const first = (() => {
    const d = new Date(minStart * 1000);
    const mStart = startOfMonthUtcEpoch(d.getUTCFullYear(), d.getUTCMonth());
    return mStart < minStart
      ? startOfMonthUtcEpoch(d.getUTCFullYear(), d.getUTCMonth() + 1)
      : mStart;
  })();
  const result: number[] = [];
  let cur = first;
  while (cur < maxEnd) {
    result.push(cur);
    const cd = new Date(cur * 1000);
    cur = startOfMonthUtcEpoch(cd.getUTCFullYear(), cd.getUTCMonth() + 1);
  }
  return result;
}

export function monthsBetweenEpochs(startEpoch: number, endEpoch: number): number {
  return monthStartsBetween(startEpoch, endEpoch).length;
}
