// src/app/api/stripe/subscription-overview/route.ts
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { serverOnly } from "@/lib/validation/server-only";
import { getStripe } from "@/lib/stripe/stripe"; // ✅ use the shared helper

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(epoch?: number | null) {
  return typeof epoch === "number" && epoch > 0
    ? new Date(epoch * 1000).toISOString()
    : null;
}

type SchedulePhase = NonNullable<Stripe.SubscriptionSchedule["phases"]>[number];

type InvoiceLineItemLike = Stripe.InvoiceLineItem & {
  price?: Stripe.Price | string | null;
  plan?: { id?: string } | null; // legacy fallback
};

export async function GET(req: Request) {
  serverOnly(); // assert server context at runtime

  try {
    const stripe = getStripe(); // ✅ first real use of the secret

    const { searchParams } = new URL(req.url);
    const subscriptionId = searchParams.get("subscriptionId") || undefined;
    const customerId = searchParams.get("customerId") || undefined;

    if (!subscriptionId && !customerId) {
      return NextResponse.json(
        { error: "Provide subscriptionId or customerId in query string" },
        { status: 400 }
      );
    }

    // 1) Locate the subscription (either by id, or by most-recent active for a customer)
    let sub: Stripe.Subscription | null = null;

    if (subscriptionId) {
      sub = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["schedule", "schedule.phases", "items.data.price"],
      });
    } else {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1,
      });
      sub = list.data[0] ?? null;
      if (sub) {
        sub = await stripe.subscriptions.retrieve(sub.id, {
          expand: ["schedule", "schedule.phases", "items.data.price"],
        });
      }
    }

    if (!sub) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 }
      );
    }

    const resolvedCustomerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

    // 2) Read the linked schedule (if any). If not present, try to find it.
    let schedule: Stripe.SubscriptionSchedule | null = null;

    if (sub.schedule) {
      const schedId =
        typeof sub.schedule === "string"
          ? sub.schedule
          : (sub.schedule as Stripe.SubscriptionSchedule).id;

      schedule = await stripe.subscriptionSchedules.retrieve(schedId, {
        expand: ["phases"],
      });
    } else {
      const scheduleIdFromMeta = sub.metadata?.schedule_id;
      if (scheduleIdFromMeta) {
        try {
          schedule = await stripe.subscriptionSchedules.retrieve(
            scheduleIdFromMeta,
            { expand: ["phases"] }
          );
        } catch {
          console.warn(
            "[overview] schedule_id in metadata not retrievable:",
            scheduleIdFromMeta
          );
        }
      }

      if (!schedule && resolvedCustomerId) {
        const list = await stripe.subscriptionSchedules.list({
          customer: resolvedCustomerId,
          limit: 20,
          expand: ["data.phases"],
        });

        schedule =
          list.data.find((s) => {
            const schedSubId =
              typeof s.subscription === "string"
                ? s.subscription
                : s.subscription?.id;
            return schedSubId === sub!.id;
          }) ?? null;
      }
    }

    // 3) Build a human-friendly "calendar" for phases

    console.log('[API] Schedule phases count:', schedule?.phases?.length || 0);
    
    const lastPhase: SchedulePhase | undefined =
      schedule && Array.isArray(schedule.phases) && schedule.phases.length
        ? (schedule.phases[schedule.phases.length - 1] as SchedulePhase)
        : undefined;

    // Open-ended if there’s no fixed end_date and no iteration count
    // const lastPhaseIsOpenEnded =
    //   !!lastPhase && !lastPhase.end_date && !lastPhase.iterations;

    const lastPhaseIsOpenEnded = 
      schedule && (
        schedule.end_behavior === "release" || 
        (!!lastPhase && !lastPhase.end_date)
      );

    const schedSummary = schedule
      ? {
          id: schedule.id,
          current_phase: schedule.current_phase
            ? {
                start: toIso(schedule.current_phase.start_date),
                end: toIso(schedule.current_phase.end_date ?? null),
              }
            : null,
          phases: (schedule.phases ?? []).map((p: SchedulePhase) => {
            console.log('[API] Phase:', {
              start_date: p.start_date,
              end_date: p.end_date,
              items: p.items?.map(i => ({ 
                price: typeof i.price === 'string' ? i.price : i.price?.id,
                qty: i.quantity 
              }))
            });
            return {
              start: toIso(p.start_date ?? null),
              end: toIso(p.end_date ?? null),
              // For readability, only expose price IDs and quantities
              items: (p.items ?? []).map((i) => ({
                price:
                  typeof i.price === "string"
                    ? i.price
                    : (i.price?.id as string | undefined),
                quantity: i.quantity ?? 0,
              })),
            };
          }),
          last_phase_open_ended: lastPhaseIsOpenEnded,
        }
      : null;

    // 4) Preview the next invoice for this subscription
    let nextInvoice: {
      amount_due: number;
      currency: string;
      next_payment_attempt: string | null;
      lines: Array<{
        price: string | undefined;
        quantity: number | null;
        amount: number | null;
        period: { start: string | null; end: string | null };
      }>;
    } | null = null;

    if (resolvedCustomerId) {
      const preview = (await stripe.invoices.createPreview({
        customer: resolvedCustomerId,
        subscription: sub.id,
        expand: ["lines.data.price"],
      })) as Stripe.Invoice;

      nextInvoice = {
        amount_due: preview.amount_due ?? 0,
        currency: (preview.currency ?? "usd").toUpperCase(),
        next_payment_attempt: toIso(preview.next_payment_attempt ?? null),
        lines: (preview.lines?.data ?? []).map((l: InvoiceLineItemLike) => ({
          price: (l.price as Stripe.Price | undefined)?.id ?? undefined,
          quantity: l.quantity ?? null,
          amount: l.amount ?? null,
          period: {
            start: toIso(l.period?.start ?? null),
            end: toIso(l.period?.end ?? null),
          },
        })),
      };
    }

    // 5) Include price metadata for proper labeling on client
    const priceMetadata: Record<string, { name: string; type: 'base' | 'seasonal' }> = {};
    
    // Collect all price IDs from subscription items
    for (const item of sub.items.data) {
      const priceId = typeof item.price === 'string' ? item.price : item.price.id;
      const priceObj = typeof item.price === 'string' ? null : item.price;
      
      if (priceId && !priceMetadata[priceId]) {
        // Determine if base or seasonal by looking at nickname or product
        const nickname = priceObj?.nickname || '';
        const isBase = nickname.toLowerCase().includes('trash') || 
                       nickname.toLowerCase().includes('base') ||
                       (item.quantity || 0) > 1; // base typically has quantity = # of properties
        
        priceMetadata[priceId] = {
          name: isBase ? 'Base Trash Service' : 'Seasonal 2nd Pickup',
          type: isBase ? 'base' : 'seasonal'
        };
      }
    }

    return NextResponse.json({
      subscriptionId: sub.id,
      customerId: resolvedCustomerId,
      nextInvoice,
      schedule: schedSummary,
      priceMetadata,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("subscription-overview error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
