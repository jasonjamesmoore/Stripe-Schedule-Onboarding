"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { stripePromise } from "./elements";
import { Button } from "@/components/ui/button";
import type { Plan } from "@/features/payments/stripe/shared/plan";
import { DataTable } from "@/features/payments/ui-invoice/invoice-ui";
import {
  createColumns,
  type InvoiceUI,
  type InvoiceTableMeta,
} from "@/features/payments/ui-invoice/columns";
import type { AccountType } from "@/features/payments/stripe/server/prices";

type ServiceAddr = {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    return typeof m === "string" ? m : "Unknown error";
  }
  return "Unknown error";
}

const routeFor = (account: AccountType) =>
  account === "business"
    ? "/api/stripe/create-subscription/business"
    : "/api/stripe/create-subscription/individual";

// find the wizard's "Next" slot (added in the form)
function useWizardNextSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let mounted = true;
    const find = () =>
      mounted &&
      setSlot(
        document.getElementById("wizard-next-slot") as HTMLElement | null
      );
    find();
    const obs = new MutationObserver(find);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      mounted = false;
      obs.disconnect();
    };
  }, []);
  return slot;
}

const money = (cents?: number, currency = "USD") => {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return (n / 100).toLocaleString("en-US", { style: "currency", currency });
};

export function PaymentStep({
  email,
  plan,
  services,
  canPay,
  onSuccess,
  account = "individual",
}: {
  email?: string;
  plan?: Plan;
  services: ServiceAddr[];
  canPay: boolean;
  onSuccess: () => void;
  account?: AccountType;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const latestReq = useRef(0);
  const slot = useWizardNextSlot();
  const [confirmAPI, setConfirmAPI] = useState<{
    confirm: () => void;
    canConfirm: boolean;
    busy: boolean;
  } | null>(null);

  // display prices
  const [unit, setUnit] = useState<{
    trash: number;
    seasonal_2nd: number;
    currency: string;
  } | null>(null);

  // per-row selection (two checkboxes)
  type RowSel = { trash: boolean; seasonal_2nd: boolean };
  const defaultRow = useMemo<RowSel>(
    () => ({ trash: true, seasonal_2nd: plan === "seasonal_2nd" }),
    [plan]
  );
  const [rows, setRows] = useState<RowSel[]>([]);

  // keep rows aligned with services length (apply defaults for new rows)
  useEffect(() => {
    setRows((prev) =>
      Array.from({ length: services.length }, (_, i) => prev[i] ?? defaultRow)
    );
  }, [services.length, defaultRow]);

  // load unit amounts for display
  //
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(routeFor(account), {
          method: "GET",
          signal: ctrl.signal,
        });
        // Guard before json()
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Failed to load prices (${res.status})`);
        }
        const json = await res.json();
        setUnit({
          trash: json?.amounts?.trash ?? 0,
          seasonal_2nd: json?.amounts?.seasonal_2nd ?? 0,
          currency: (json?.currency ?? "USD").toUpperCase(),
        });
      } catch (e: unknown) {
        const aborted =
          (typeof DOMException !== "undefined" &&
            e instanceof DOMException &&
            e.name === "AbortError") ||
          (typeof e === "object" &&
            e !== null &&
            "name" in e &&
            (e as { name?: unknown }).name === "AbortError");
        if (!aborted) {
          console.warn("Price load failed:", e);
        }
      }
    })();
    return () => ctrl.abort();
  }, [account]);

  useEffect(() => {
    if (!plan || clientSecret) return; // don't mutate once in the payment phase
    setRows((prev) =>
      prev.map(() => ({
        trash: true,
        seasonal_2nd: plan === "seasonal_2nd", // global default applied to every row
      }))
    );
  }, [plan, clientSecret, services.length]);

  const options = useMemo(
    () =>
      clientSecret
        ? { clientSecret, appearance: { labels: "floating" as const } }
        : undefined,
    [clientSecret]
  );

  const labelFor = (s: ServiceAddr) => {
    const cityState =
      s.city && s.state ? `${s.city}, ${s.state}` : s.city || s.state || "";
    return [s.line1, cityState, s.postalCode].filter(Boolean).join(" • ");
  };

  const rowAmount = useCallback((r: RowSel) =>
    (unit?.trash ?? 0) + (r.seasonal_2nd ? unit?.seasonal_2nd ?? 0 : 0), [unit]);
  const totalCents = useMemo(() => rows.reduce((sum, r) => sum + rowAmount(r), 0), [rows, rowAmount]);

  const tableData = useMemo<InvoiceUI[]>(() => {
    return services.map((s, idx) => {
      const r = rows[idx] ?? defaultRow;
      return {
        idx,
        serviceAddress: labelFor(s) || "Service Address",
        seasonal_2nd: r.seasonal_2nd, // drives the Seasonal checkbox
        monthly: unit ? money(rowAmount(r), unit.currency) : "—",
      };
    });
  }, [services, rows, defaultRow, unit, rowAmount]);

  const columns = useMemo(() => createColumns(), []);

  const meta = useMemo<InvoiceTableMeta>(
    () => ({
      clientLocked: !!clientSecret, // disables toggles once payment starts
      toggleSeasonal: (idx, next) => {
        setRows((prev) =>
          prev.map((row, i) =>
            i === idx ? { ...row, seasonal_2nd: next } : row
          )
        );
      },
    }),
    [clientSecret, setRows]
  );
  // ---------- Phase 1: Configure ----------
  const canStartPayment =
    !!email && !!plan && services.length > 0 && canPay && !starting;

  const startPayment = async () => {
    if (!canStartPayment) return;
    setStarting(true);
    setFetchError(null);
    const reqId = ++latestReq.current;
    try {
      const res = await fetch(routeFor(account), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          plan,
          services,
          account,
          selections: rows.map((r) => ({ seasonal_2nd: r.seasonal_2nd })),
        }),
      });

      // Guard before json()
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text || `Failed to create subscription (${res.status})`
        );
      }

      const json = await res.json();
      if (latestReq.current !== reqId) return; // ignore stale
      setClientSecret(json.clientSecret); // -> Phase 2
    } catch (e) {
      if (latestReq.current !== reqId) return;
      setFetchError(getErrorMessage(e));
    } finally {
      if (latestReq.current === reqId) setStarting(false);
    }
  };

  // ---------- Phase 2: Payment ----------
  const resetToConfigure = () => {
    // “Edit items” — tear down Elements and go back to table
    setClientSecret(null);
    setFetchError(null);
  };

  // small guards
  if (!email || !plan)
    return (
      <p className="text-sm text-muted-foreground">
        Enter your email and choose a plan to continue.
      </p>
    );
  if (services.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Add at least one service address to continue.
      </p>
    );

  return (
    <>
      {/* Items table (shown in both phases for clarity; toggles disabled once in payment phase) */}
      <div className="space-y-2">
        <div className="text-sm font-medium">
          Build your Trash Valet Subscription Plan:
        </div>

        <DataTable columns={columns} data={tableData} meta={meta} />

        {/* Total per month */}
        <div className="flex items-center justify-between pt-2">
          {!clientSecret ? (
            <div className="text-xs text-muted-foreground">
              Total monthly price displayed reflects in-season dates for all
              addresses.
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={resetToConfigure}>
              Edit items
            </Button>
          )}
          <div className="text-xl font-extrabold">
            Total - {unit ? `${money(totalCents, unit.currency)} / mo` : "—"}
          </div>
        </div>
      </div>

      {/* Phase switch */}
      {!clientSecret ? (
        <>
          {fetchError && <p className="text-sm text-red-600">{fetchError}</p>}
          {slot ? (
            createPortal(
              <Button
                type="button"
                onClick={startPayment}
                disabled={!canStartPayment}
                className="bg-[#254B58] text-[#FCCF86]"
              >
                {starting ? "Preparing…" : "Continue to payment"}
              </Button>,
              slot
            )
          ) : (
            <div className="flex items-center justify-end pt-4">
              <Button
                type="button"
                onClick={startPayment}
                disabled={!canStartPayment}
                className="bg-[#254B58] text-[#FCCF86]"
              >
                {starting ? "Preparing…" : "Continue to payment"}
              </Button>
            </div>
          )}
        </>
      ) : options ? (
        <Elements stripe={stripePromise} options={options} key={clientSecret}>
          <PaymentForm
            canPay={canPay}
            onSuccess={onSuccess}
            hideButton={Boolean(slot && confirmAPI)} // hide only when portal & api are ready
            expose={(api) =>
              setConfirmAPI((prev) =>
                prev &&
                prev.confirm === api.confirm &&
                prev.canConfirm === api.canConfirm &&
                prev.busy === api.busy
                  ? prev
                  : api
              )
            }
          />
        </Elements>
      ) : null}
      {clientSecret &&
        slot &&
        confirmAPI &&
        createPortal(
          <Button
            type="button"
            onClick={confirmAPI.confirm}
            disabled={!confirmAPI.canConfirm || confirmAPI.busy}
            className="bg-[#254B58] text-[#FCCF86]"
          >
            {confirmAPI.busy ? "Processing…" : "Pay & Subscribe"}
          </Button>,
          slot
        )}
    </>
  );
}

function PaymentForm({
  canPay,
  onSuccess,
  hideButton,
  expose,
}: {
  canPay: boolean;
  onSuccess: () => void;
  hideButton?: boolean;
  expose?: (api: {
    confirm: () => void;
    canConfirm: boolean;
    busy: boolean;
  }) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onPay = useCallback(async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    setBusy(false);
    if (error) {
      setErr(error.message ?? "Payment failed");
      return;
    }
    onSuccess();
  }, [stripe, elements, onSuccess]);

  // let the parent (PaymentStep) render the button elsewhere
  const canConfirm = Boolean(canPay && stripe && elements && !busy);
  const last = useRef<{
    confirm: () => void;
    canConfirm: boolean;
    busy: boolean;
  } | null>(null);
  useEffect(() => {
    const next = { confirm: onPay, canConfirm, busy };
    const prev = last.current;
    const changed =
      !prev ||
      prev.confirm !== next.confirm ||
      prev.canConfirm !== next.canConfirm ||
      prev.busy !== next.busy;
    if (changed) {
      last.current = next;
      expose?.(next);
    }
  }, [onPay, canConfirm, busy, expose]);

  return (
    <div className="space-y-4">
      <PaymentElement />
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!hideButton && (
        <div className="flex items-center justify-end pt-4">
          <Button
            type="button"
            onClick={onPay}
            disabled={!canPay || !stripe || !elements || busy}
            className="bg-[#254B58] text-[#FCCF86]"
          >
            {busy ? "Processing…" : "Pay & Subscribe"}
          </Button>
        </div>
      )}
      {!canPay && (
        <p className="text-xs text-muted-foreground">
          Please agree to the terms and add at least one address.
        </p>
      )}
    </div>
  );
}
