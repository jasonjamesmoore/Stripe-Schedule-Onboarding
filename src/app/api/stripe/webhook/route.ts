// src/app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe/stripe";
import { requireWebhookSecret } from "@/lib/env/env.server";
import { alreadyProcessed } from "@/lib/stripe/webhook/dedupe";
import { asStr } from "@/lib/util/strings";
import { getSubscriptionIdFromInvoice } from "@/lib/stripe/invoices";
import { ensureScheduleAttached, upsertScheduleFromSubscription } from "@/lib/stripe/scheduleAttach";
// import { nextSeasonWindow } from "@/lib/season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = ["iad1"]; // US-East (Washington, DC)
export const maxDuration = 15; // seconds (optional)

/* ----------------------------- Types ----------------------------- */

type InvoiceLike = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
};

type InvoiceWithBalanceFields = Stripe.Invoice & {
  applied_balance_amount?: number;
  ending_balance?: number;
};

type SubscriptionLike = Stripe.Subscription & {
  current_period_start?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string>;
};

type InvoiceWithExpandedSub = Stripe.Invoice & {
  subscription?: string | (Stripe.Subscription & { id: string }) | null;
};




/* ---------------------------------- Webhook entrypoint ---------------------------------- */

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Missing Stripe signature" },
      { status: 400 }
    );
  }

  // Raw body is required for signature verification in app router
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(
      rawBody,
      sig,
      requireWebhookSecret()
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid payload";
    return NextResponse.json(
      { error: `Webhook Error: ${msg}` },
      { status: 400 }
    );
  }

  // process-lifetime de-dupe
  if (await alreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, deduped: true });
  }

  try {
    const stripe = getStripe(); // instantiate client once per request

    switch (event.type) {
      case "invoice.paid": {
        const base = event.data.object as Stripe.Invoice & {
          billing_reason?: string;
        };
        const invId = base.id;
        if (typeof invId !== "string") throw new Error("Invoice missing id");

        const fullResp = await stripe.invoices.retrieve(invId, {
          expand: ["subscription", "lines.data.subscription"],
        });

        const fullInv = fullResp as unknown as InvoiceWithExpandedSub;
        const subId =
          typeof fullInv.subscription === "string"
            ? fullInv.subscription
            : fullInv.subscription?.id ?? "";
        const custId =
          typeof fullInv.customer === "string" ? fullInv.customer : "";

        const invWithBalance = fullResp as InvoiceWithBalanceFields;
        console.log("[WH] invoice.paid (expanded)", {
          invoiceId: invWithBalance.id,
          customerId: custId,
          subscriptionId: subId,
          billing_reason: base.billing_reason,
          amount_due: invWithBalance.amount_due,
          amount_paid: invWithBalance.amount_paid,
          amount_remaining: invWithBalance.amount_remaining,
          starting_balance: invWithBalance.starting_balance,
          applied_balance_amount: invWithBalance.applied_balance_amount,
          ending_balance: invWithBalance.ending_balance,
        });

        await onInvoicePaid(fullInv as InvoiceLike, stripe);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as InvoiceLike;
        await onInvoiceFailed(invoice);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as SubscriptionLike;
        await onSubscriptionUpdated(sub, stripe);

        // Back-stop: active + stashed metadata + no schedule → try attach now
        if (
          sub.status === "active" &&
          !!sub.metadata?.schedule_phases &&
          !sub.schedule
        ) {
          console.log(
            "[WH] subscription.updated back-stop attach → sub:",
            sub.id
          );
          await upsertScheduleFromSubscription(sub.id, stripe);
        }
        break;
      }

      case "subscription_schedule.created":
      case "subscription_schedule.updated": {
        const sched = event.data.object as Stripe.SubscriptionSchedule;
        await onScheduleUpserted(sched);
        break;
      }

      default:
        // Ack unhandled event types
        break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Webhook handler error:", event.type, msg);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/* ---------------------------------- Event handlers ---------------------------------- */

async function onInvoicePaid(inv: InvoiceLike, stripe: Stripe) {
  const customerId = asStr(inv.customer);
  const subscriptionId = asStr(inv.subscription);
  const amountPaid = inv.amount_paid ?? 0;
  const periodStart = inv.period_start ?? undefined;
  const periodEnd = inv.period_end ?? undefined;

  console.log("invoice.paid", {
    subscriptionId,
    customerId,
    amountPaid,
    periodStart,
    periodEnd,
  });

  const subId =
    subscriptionId || (await getSubscriptionIdFromInvoice(inv, stripe));
  if (subId) {
    await ensureScheduleAttached(subId, stripe);
  } else {
    console.warn(
      "[WH] invoice.paid without resolvable subscription id, skipping schedule attach"
    );
  }
}

async function onInvoiceFailed(inv: InvoiceLike) {
  const customerId = asStr(inv.customer);
  const subscriptionId = asStr(inv.subscription);
  console.warn("invoice.payment_failed", {
    subscriptionId,
    customerId,
    attemptCount: inv.attempt_count,
  });
}

async function onSubscriptionUpdated(sub: SubscriptionLike, stripe: Stripe) {
  const customerId = asStr(sub.customer);
  const subscriptionId = sub.id;
  const status = sub.status;
  const periodEnd = sub.current_period_end;
  const items = sub.items.data.map((i) => ({
    price: i.price.id,
    qty: i.quantity ?? 0,
  }));
  console.log("customer.subscription.updated", {
    subscriptionId,
    customerId,
    status,
    periodEnd,
    items,
  });

  if (["active", "trialing", "past_due", "unpaid"].includes(status)) {
    await ensureScheduleAttached(subscriptionId, stripe);
  }
}

async function onScheduleUpserted(sched: Stripe.SubscriptionSchedule) {
  const scheduleId = sched.id;
  const subscriptionId = asStr(sched.subscription);
  const phases = (sched.phases ?? []).map((p) => ({
    end: p.end_date ?? null,
    items: (p.items ?? []).map((i) => ({
      price: typeof i.price === "string" ? i.price : i.price.id,
      qty: i.quantity ?? 0,
    })),
  }));
  console.log("subscription_schedule.upserted", {
    scheduleId,
    subscriptionId,
    phases,
  });
}

/* ----------------------------- Schedule attach/update routine ----------------------------- */



/* ----------------------------- Evergreen extender ( potential future use) ----------------------------- */
/**
 * maybeExtendEvergreen(scheduleId):
 *  - Skips if any open-ended phase exists.
 *  - Skips when phase count is at Stripe's cap (10).
 *  - Skips if tail end is comfortably beyond thresholdDays.
 *  - Skips if next seasonal start is >90 days after the tail.
 *  - Appends only future phases; avoids rewriting ended phases.
 *  - Persists 'extended_until' to avoid repeated work for the same season end.
 * Note: currently builds an empty append set; keep as a scaffold for the nightly extender.
 */
// async function maybeExtendEvergreen(
//   scheduleId: string,
//   opts?: { thresholdDays?: number; appendMonths?: number }
// ) {
//   const thresholdDays = opts?.thresholdDays ?? 60;

//   const sched = await stripe.subscriptionSchedules.retrieve(scheduleId, {
//     expand: ["phases", "subscription"],
//   });

//   const hasOpenEnded = (sched.phases ?? []).some((p) => {
//     const ph = p as PhaseRead;
//     return typeof ph.end_date !== "number" && !hasIterations(ph);
//   });
//   if (hasOpenEnded) {
//     console.log("[WH] evergreen: open-ended phase present → skip extension");
//     return;
//   }

//   const existing = sched.phases ?? [];
//   const MAX = 10;
//   if (existing.length >= MAX) {
//     console.log(
//       "[WH] maybeExtendEvergreen: no room to append phases; skipping"
//     );
//     return;
//   }

//   const tailEnd = Math.max(...existing.map((p) => p.end_date ?? 0));

//   const now = Math.floor(Date.now() / 1000);
//   const threshold = now + thresholdDays * 24 * 60 * 60;

//   if (tailEnd > threshold) {
//     console.log("[WH] evergreen: tail comfortably beyond threshold → skip");
//     return;
//   }

//   const NINETY_DAYS = 90 * 24 * 60 * 60;
//   const next = nextSeasonWindow(tailEnd);
//   if (next.start - tailEnd > NINETY_DAYS) {
//     console.log("[WH] evergreen: next season too far (>90d) → skip");
//     return;
//   }

//   const alreadyExtendedUntil = Number(sched.metadata?.extended_until || 0);

//   if (tailEnd <= now) {
//     console.log("[WH] maybeExtendEvergreen: tail already past; not appending");
//     return;
//   }

//   const activeOrFuture = existing.filter(
//     (p) => !p.end_date || p.end_date > now
//   );
//   const preserved: Stripe.SubscriptionScheduleUpdateParams.Phase[] =
//     activeOrFuture.map((p) => {
//       const items = (p.items ?? []).map((it) => ({
//         price: typeof it.price === "string" ? it.price : it.price.id,
//         quantity: it.quantity!,
//       }));
//       const obj: PhaseUpdate = { items };
//       if (typeof p.start_date === "number") obj.start_date = p.start_date;
//       if (typeof p.end_date === "number") obj.end_date = p.end_date;
//       const pr = p as PhaseRead;
//       if (hasIterations(pr)) obj.iterations = pr.iterations as number;
//       return obj;
//     });

//   const BASE_PRICE = PRICE_BY_PLAN.trash;
//   const SEASONAL_PRICE = PRICE_BY_PLAN.seasonal_2nd;
//   let baseQty = 0;
//   let seasonalQtyMax = 0;
//   for (const p of existing) {
//     for (const it of p.items ?? []) {
//       const priceId = typeof it.price === "string" ? it.price : it.price.id;
//       const q = typeof it.quantity === "number" ? it.quantity : 0;
//       if (priceId === BASE_PRICE) baseQty = q;
//       if (priceId === SEASONAL_PRICE && q > seasonalQtyMax) seasonalQtyMax = q;
//     }
//   }
//   if (baseQty <= 0) {
//     console.log("[WH] maybeExtendEvergreen: no baseQty found; skipping");
//     return;
//   }

//   if (alreadyExtendedUntil >= next.end) {
//     console.log(
//       "[WH] maybeExtendEvergreen: already extended to",
//       alreadyExtendedUntil,
//       "≥",
//       next.end
//     );
//     return;
//   }

//   const toAppend: Stripe.SubscriptionScheduleUpdateParams.Phase[] = [];

//   const updatePayload: Stripe.SubscriptionScheduleUpdateParams = {
//     phases: [...preserved, ...toAppend],
//     end_behavior: "release",
//     metadata: { ...sched.metadata, extended_until: String(next.end) },
//   };

//   try {
//     await stripe.subscriptionSchedules.update(scheduleId, updatePayload);
//     console.log(
//       "[WH] maybeExtendEvergreen: extended schedule",
//       scheduleId,
//       "{ appended:",
//       toAppend.length,
//       "}"
//     );
//   } catch (err) {
//     console.error(
//       "[WH] maybeExtendEvergreen update ERROR:",
//       (err as { message?: string })?.message
//     );
//   }
// }

// evergreen extender scaffold end
//------------------------------------
