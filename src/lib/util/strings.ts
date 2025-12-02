export function asStr(x: unknown): string {
  return typeof x === "string" ? x : ((x ?? "") as string);
}
