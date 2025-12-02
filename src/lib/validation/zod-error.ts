import { z } from "zod";

export interface ZodErrorTree {
  errors?: string[];
  properties?: Record<string, ZodErrorTree | undefined>;
  items?: Array<ZodErrorTree | undefined>;
}
export type ErrorMap = Record<string, string[]>;
const toPath = (segs: readonly (string | number)[]) => segs.map(String).join(".");

export function collectErrorsFromTree(
  node: ZodErrorTree | undefined,
  prefix: readonly (string | number)[] = [],
  out: ErrorMap = {}
): ErrorMap {
  if (!node) return out;
  if (node.errors?.length) out[toPath(prefix)] = [...(out[toPath(prefix)] ?? []), ...node.errors];
  if (node.properties) for (const [k, child] of Object.entries(node.properties)) if (child) collectErrorsFromTree(child, [...prefix, k], out);
  if (node.items) node.items.forEach((child, i) => { if (child) collectErrorsFromTree(child, [...prefix, i], out); });
  return out;
}

export const treeify = (err: z.ZodError) => z.treeifyError(err);
export const flatten = (err: z.ZodError) => z.flattenError(err);
