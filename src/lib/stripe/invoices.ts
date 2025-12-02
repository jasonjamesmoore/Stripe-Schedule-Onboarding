import type Stripe from "stripe";
// import { stripe } from "@/lib/stripe/client";

type InvoiceWithExpandedSub = Stripe.Invoice & {
  subscription?: string | (Stripe.Subscription & { id: string }) | null;
};

/**
 * Resolve a subscription id from a possibly unexpanded Invoice.
 * Fallback order:
 *  1) invoice.subscription if string
 *  2) expanded subscription.id
 *  3) re-fetch with ["subscription", "lines.data.subscription"]
 *  4) scan lines for a subscription reference
 */
export async function getSubscriptionIdFromInvoice(
  inv: { id?: string; subscription?: unknown }, stripe: Stripe
): Promise<string | undefined> {
  if (typeof inv.subscription === "string") return inv.subscription;

  if (
    inv.subscription &&
    typeof inv.subscription === "object" &&
    "id" in inv.subscription &&
    typeof (inv.subscription as { id: unknown }).id === "string"
  ) {
    return (inv.subscription as { id: string }).id;
  }

  if (!inv.id) return undefined;
  const invId: string = inv.id;

  const fullResp = await stripe.invoices.retrieve(invId, {
    expand: ["subscription", "lines.data.subscription"],
  });

  const full = fullResp as unknown as InvoiceWithExpandedSub;
  const subField = full.subscription;

  if (typeof subField === "string") return subField;
  if (
    subField &&
    typeof subField === "object" &&
    "id" in subField &&
    typeof (subField as { id: unknown }).id === "string"
  ) {
    return (subField as { id: string }).id;
  }

  const lines = (fullResp as Stripe.Invoice).lines?.data ?? [];
  const line = lines.find((l) => l.subscription);
  if (line) {
    if (typeof line.subscription === "string") return line.subscription;
    if (
      line.subscription &&
      typeof line.subscription === "object" &&
      "id" in line.subscription &&
      typeof (line.subscription as { id: unknown }).id === "string"
    ) {
      return (line.subscription as { id: string }).id;
    }
  }
  return undefined;
}
