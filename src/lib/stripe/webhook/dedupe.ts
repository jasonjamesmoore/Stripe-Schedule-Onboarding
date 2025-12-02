// src/lib/stripe/webhook/dedupe.ts

/**
 * Simple process-lifetime deduplication for Stripe events.
 * Works fine in dev or single-region server instances.
 *
 * If add persistent storage (Vercel KV, Redis, Supabase, etc.),
 * replace this Set-based approach with a SETNX+TTL check.
 */

const seen = new Set<string>();

export async function alreadyProcessed(id: string): Promise<boolean> {
  // Future placeholder for KV/Redis/etc.
  // Example:
  // const ok = await kv.setnx(`stripe_evt:${id}`, "1", { ex: 86400 });
  // return !ok;

  if (seen.has(id)) return true;
  seen.add(id);
  return false;
}

