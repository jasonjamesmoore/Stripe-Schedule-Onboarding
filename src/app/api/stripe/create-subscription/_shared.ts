// src/app/api/stripe/create-subscription/_shared.ts
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/stripe";
import { serverOnly } from "@/lib/validation/server-only";
import {
  PRICE_BY_PLAN,
  type AccountType,
} from "@/features/payments/stripe/server/prices";
import type { Plan } from "@/features/payments/stripe/shared/plan";
import { PRORATION_BEHAVIOR } from "@/lib/stripe/constants";
import { buildSignupPhases } from "@/lib/stripe/phaseBuilder";
import { createHash } from "crypto";
import {
  resolveRuleForAddress,
  type Address as SAAddress,
} from "@/lib/serviceAreas/serviceAreas";

export function makeHandlers(account: AccountType) {
  // ——— shared types ———
  type Body = {
    email: string;
    plan: Plan;
    services: Array<Record<string, unknown>>;
    billing?: Record<string, unknown>;
    selections: Array<{ seasonal_2nd?: boolean }>
  };
  type PhaseWithDuration = Stripe.SubscriptionScheduleCreateParams.Phase & {
    duration?: { interval: "month"; interval_count: number };
  };
  type CompactPhase = Pick<
    Stripe.SubscriptionScheduleCreateParams.Phase,
    "items" | "end_date" | "proration_behavior"
  > & { duration?: { interval: "month"; interval_count: number } };
  type InvoiceWithCS = Stripe.Invoice & {
    confirmation_secret?: { client_secret?: string | null } | string | null;
  };

  // ——— tiny utils ———
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  const maskEmail = (email?: string) => {
    if (!email) return "(unknown)";
    const [user, domain = ""] = email.split("@");
    const head = user ? user[0] : "";
    const stars = user.length > 1 ? "*".repeat(user.length - 1) : "*";
    return `${head}${stars}@${domain}`;
  };
  const getErrorMessage = (err: unknown) =>
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : JSON.stringify(err);

  // compact “per-address” metadata shape to avoid Stripe's 500-char limit
  type AddrRuleCompact = {
    c: string;
    z: string;
    b: number;
    s: number;
    ss: number;
    se: number;
  };

  const cleanZip = (z?: string) => (z ?? "").trim().slice(0, 5);
  const toSAAddress = (svc: Record<string, unknown>): SAAddress => ({
    line1: String(svc.line1 ?? ""),
    city: String(svc.city ?? ""),
    state: String(svc.state ?? ""),
    zip: cleanZip(String(svc.postalCode ?? svc.zip ?? "")),
  });

  // Resolve rules for all services; return compact array + list of any failures
  function buildAddrRulesCompact(services: Array<Record<string, unknown>>) {
    const compact: AddrRuleCompact[] = [];
    const failures: number[] = [];

    services.forEach((svc, idx) => {
      const addr = toSAAddress(svc);
      const rule = resolveRuleForAddress(addr);
      if (!rule) {
        failures.push(idx);
        return;
      }
      compact.push({
        c: addr.city,
        z: addr.zip,
        b: rule.baseDay,
        s: rule.secondaryDay ?? -1,
        ss: rule.season?.startUTC ?? -1,
        se: rule.season?.endUTC ?? -1,
      });
    });

    return { compact, failures };
  }

  // Stripe metadata hard limit ≈ 500 chars per field. Chunk long JSON strings safely.
  function chunkForMetadata(prefix: string, json: string, perFieldMax = 480) {
    const chunks: Record<string, string> = {};
    if (json.length <= perFieldMax) {
      chunks[prefix] = json;
      return chunks;
    }
    let i = 1,
      start = 0;
    while (start < json.length) {
      const end = Math.min(start + perFieldMax, json.length);
      chunks[`${prefix}_${i}`] = json.slice(start, end);
      start = end;
      i++;
    }
    return chunks;
  }

  return {
    // ---------- POST ----------
    POST: async (req: Request) => {
      serverOnly();
      const stripe = getStripe();
      let emailForLog: string | undefined;

      try {
        const body = (await req.json()) as Body;
        const { email, services, billing, selections } = body;
        emailForLog = email;
        const addrMini = services.map((s) => ({
          c: String(s.city ?? ""),
          z: cleanZip(String(s.postalCode ?? s.zip ?? "")),
        }));
        const addrMiniJson = JSON.stringify(addrMini);
        const addrMiniChunks = chunkForMetadata("addr_mini", addrMiniJson);

        if (!email)
          return NextResponse.json({ error: "Missing email" }, { status: 400 });
        if (!Array.isArray(services) || services.length < 1) {
          return NextResponse.json(
            { error: "At least one service address is required" },
            { status: 400 }
          );
        }
        if (
          !Array.isArray(selections) ||
          services.length !== selections.length
        ) {
          return NextResponse.json(
            { error: "Selections must match service addresses" },
            { status: 400 }
          );
        }
        if (selections.some((s) => !s || typeof s !== "object")) {
          return NextResponse.json(
            { error: "Invalid selection object(s)" },
            { status: 400 }
          );
        }

        // Resolve per-address rules server-side (authoritative)
        const { compact: addrRules, failures } =
          buildAddrRulesCompact(services);
        if (failures.length) {
          // Return a meaningful error that maps back to the failing card indices
          return NextResponse.json(
            { error: "Some addresses are outside our service areas", failures },
            { status: 400 }
          );
        }

        // Prepare compact JSON and chunk for metadata
        const addrRulesJson = JSON.stringify(addrRules);
        const addrRuleChunks = chunkForMetadata("addr_rules", addrRulesJson);

        // 👇 pick price map for this account
        const priceMap = PRICE_BY_PLAN[account];

        const nowEpoch = Math.floor(Date.now() / 1000);
        const { phases, nextFirst, baseQty } = buildSignupPhases({
          services,
          selections,
          nowEpoch,
          priceIds: { base: priceMap.trash, seasonal: priceMap.seasonal_2nd },
          prorationBehavior: PRORATION_BEHAVIOR,
        });

        if (!phases.length || !phases[0].items.length) {
          return NextResponse.json(
            { error: "No billable items" },
            { status: 400 }
          );
        }

        // Find or create customer
        const existing = await stripe.customers.list({ email, limit: 1 });
        const customer =
          existing.data[0] ?? (await stripe.customers.create({ email }));

        // Store full service addresses in customer metadata
        const fullAddresses = services.map((svc, idx) => ({
          index: idx,
          line1: String(svc.line1 ?? ""),
          line2: String(svc.line2 ?? ""),
          city: String(svc.city ?? ""),
          state: String(svc.state ?? ""),
          postal_code: cleanZip(String(svc.postalCode ?? svc.zip ?? "")),
          seasonal_selected: selections[idx]?.seasonal_2nd ?? false,
        }));
        
        const addressesJson = JSON.stringify(fullAddresses);
        const addressChunks = chunkForMetadata("service_addresses", addressesJson);

        // Update customer with billing address (or first service address as fallback)
        const primaryAddress = billing ?? services[0];
        await stripe.customers.update(customer.id, {
          address: {
            line1: String(primaryAddress.line1 ?? ""),
            line2: String(primaryAddress.line2 ?? ""),
            city: String(primaryAddress.city ?? ""),
            state: String(primaryAddress.state ?? ""),
            postal_code: cleanZip(String(primaryAddress.postalCode ?? primaryAddress.zip ?? "")),
            country: "US", // Assuming US addresses
          },
          metadata: {
            ...addressChunks,
            service_address_count: String(services.length),
          },
        });

        // Idempotency keys (separate endpoints)
        const first = phases[0] as PhaseWithDuration | undefined;
        const firstPhaseSig =
          first?.duration?.interval === "month" &&
          typeof first.duration.interval_count === "number"
            ? `dur:${first.duration.interval_count}`
            : typeof first?.end_date === "number"
            ? `end:${first.end_date}`
            : "unknown";
        const lastItemsSig = (phases.at(-1)?.items ?? [])
          .map((i) => (typeof i.quantity === "number" ? i.quantity : 0))
          .join(",");
        const baseRaw = `sched:${customer.id}:${baseQty}:${phases.length}:${firstPhaseSig}:${lastItemsSig}:${account}`;
        const subCreateIdem = sha256(baseRaw + "|sub.create:v1");
        const schedCreateIdem = sha256(baseRaw + "|sched.create:v1");

        // Create subscription for initial phase
        const [initialPhase, ...schedulePhases] = phases;
        if (!initialPhase?.items?.length) {
          return NextResponse.json(
            { error: "No initial billable items" },
            { status: 400 }
          );
        }

        const sub = await stripe.subscriptions.create(
          {
            customer: customer.id,
            collection_method: "charge_automatically",
            payment_behavior: "default_incomplete",
            items: initialPhase.items,
            payment_settings: {
              save_default_payment_method: "on_subscription",
              payment_method_types: ["card"],
            },
            billing_mode: { type: "flexible" },
            expand: [
              "latest_invoice.confirmation_secret",
              "latest_invoice.payment_intent",
              "latest_invoice",
            ],
            billing_cycle_anchor: nextFirst,
            proration_behavior: "create_prorations",
            metadata: {
              ...addrRuleChunks,
              ...addrMiniChunks, // <-- NEW: per-address compact rules
              // can also tag the account type as a breadcrumb if useful
              signup_account_type: account,
            },
          },
          { idempotencyKey: subCreateIdem }
        );

        console.log("[SIGNUP] Created subscription:", sub.id, "phases from buildSignupPhases:", phases.length);
        phases.forEach((p, i) => console.log(`[SIGNUP] Phase ${i}:`, { 
          end_date: p.end_date, 
          duration: p.duration, 
          items: p.items?.length 
        }));

        // Free/zero invoice?
        const li = sub.latest_invoice as Stripe.Invoice | null | undefined;
        const amount_due = li?.amount_due ?? 0;
        if (amount_due === 0) {
          return NextResponse.json({
            ok: true,
            subscriptionId: sub.id,
            noInitialCharge: true,
            latestInvoiceId: li?.id ?? null,
          });
        }

        // Pull client_secret
        const invoice = sub.latest_invoice as InvoiceWithCS | string | null;
        const clientSecret =
          invoice &&
          typeof invoice !== "string" &&
          invoice.confirmation_secret &&
          typeof invoice.confirmation_secret !== "string"
            ? invoice.confirmation_secret.client_secret ?? undefined
            : undefined;
        if (!clientSecret) {
          return NextResponse.json(
            { error: "Failed to create payment intent" },
            { status: 400 }
          );
        }

        // Compact future phases -> stash in metadata
        const hasDuration = (
          p: PhaseWithDuration
        ): p is PhaseWithDuration & {
          duration: { interval: "month"; interval_count: number };
        } =>
          !!p.duration &&
          p.duration.interval === "month" &&
          typeof p.duration.interval_count === "number";

        const schedulePhasesTyped =
          schedulePhases as ReadonlyArray<PhaseWithDuration>;
        const compactPhases: CompactPhase[] = schedulePhasesTyped.map((p) => {
          const out: CompactPhase = {
            items: p.items ?? [],
            proration_behavior: p.proration_behavior,
          };
          if (hasDuration(p)) out.duration = p.duration;
          if (typeof p.end_date === "number") out.end_date = p.end_date;
          return out;
        });

        await stripe.subscriptions.update(sub.id, {
          metadata: {
            ...addrRuleChunks,
            ...addrMiniChunks, 
            schedule_idem: schedCreateIdem,
            schedule_phase_count: String(compactPhases.length),
            // schedule_phases: JSON.stringify(compactPhases),
            signup_account_type: account, // breadcrumb
          },
        });

        return NextResponse.json({
          clientSecret,
          subscriptionId: sub.id,
          customerId: customer.id,
        });
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        console.error(
          "Error creating subscription:",
          maskEmail(emailForLog),
          message,
          error
        );
        return NextResponse.json(
          { error: message || "Internal Server Error" },
          { status: 500 }
        );
      }
    },

    // ---------- GET ----------
    GET: async () => {
      serverOnly();
      const stripe = getStripe();
      const priceMap = PRICE_BY_PLAN[account];

      try {
        const [trash, seasonal] = await Promise.all([
          stripe.prices.retrieve(priceMap.trash),
          stripe.prices.retrieve(priceMap.seasonal_2nd),
        ]);

        return NextResponse.json({
          account,
          currency: (trash.currency ?? "usd").toUpperCase(),
          amounts: {
            trash: trash.unit_amount ?? 0,
            seasonal_2nd: seasonal.unit_amount ?? 0,
          },
        });
      } catch {
        return NextResponse.json(
          { error: "Unable to load prices" },
          { status: 500 }
        );
      }
    },
  };
}
