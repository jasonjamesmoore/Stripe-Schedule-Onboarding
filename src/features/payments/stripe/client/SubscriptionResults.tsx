"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Calendar, DollarSign, MapPin, CheckCircle2, Clock } from "lucide-react";

type PhaseItem = {
  price: string | undefined;
  quantity: number;
};

type Phase = {
  start: string | null;
  end: string | null;
  items: PhaseItem[];
};

type InvoiceLine = {
  price: string | undefined;
  quantity: number | null;
  amount: number | null;
  period: {
    start: string | null;
    end: string | null;
  };
};

type NextInvoice = {
  amount_due: number;
  currency: string;
  next_payment_attempt: string | null;
  lines: InvoiceLine[];
};

type ScheduleSummary = {
  id: string;
  current_phase: {
    start: string | null;
    end: string | null;
  } | null;
  phases: Phase[];
  last_phase_open_ended: boolean;
};

type PriceMetadata = Record<string, { name: string; type: 'base' | 'seasonal'; amount: number }>;

type SubscriptionOverview = {
  subscriptionId: string;
  customerId: string;
  nextInvoice: NextInvoice | null;
  schedule: ScheduleSummary | null;
  priceMetadata?: PriceMetadata;
};

const money = (cents: number, currency = "USD") => {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency });
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const formatDateTime = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
};

export function SubscriptionResults({
  subscriptionId,
  customerId
}: {
  subscriptionId?: string;
  customerId?: string;
}) {
  const [data, setData] = useState<SubscriptionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expectedPhaseCount, setExpectedPhaseCount] = useState<number | null>(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [lastPhaseCount, setLastPhaseCount] = useState(0);
  const MAX_POLL_ATTEMPTS = 5; // Stop polling after 5 seconds

  const fetchData = () => {
    if (!subscriptionId && !customerId) {
      setError("No subscription or customer ID provided");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    if (subscriptionId) params.set("subscriptionId", subscriptionId);
    if (customerId) params.set("customerId", customerId);

    fetch(`/api/stripe/subscription-overview?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch subscription");
        return res.json();
      })
      .then((json) => {
        const currentPhaseCount = json.schedule?.phases?.length || 0;
        
        console.log('[SubscriptionResults] Poll attempt', pollAttempts + 1, '- Phases:', currentPhaseCount, 'vs last:', lastPhaseCount);
        
        // Update data first
        setData(json);
        
        // Stop polling if:
        // 1. We've hit max attempts
        // 2. Phase count hasn't increased from last check (schedule is stable)
        // 3. No schedule exists yet but we've tried a few times
        // 4. First call and we already have phases (schedule was created before page load)
        const shouldStopPolling = 
          pollAttempts >= MAX_POLL_ATTEMPTS - 1 || 
          (currentPhaseCount > 0 && currentPhaseCount === lastPhaseCount) ||
          (currentPhaseCount === 0 && pollAttempts >= 2) ||
          (pollAttempts === 0 && currentPhaseCount >= 3); // Stop immediately if we have a full schedule on first load
        
        if (shouldStopPolling) {
          setLoading(false);
          setExpectedPhaseCount(null); // Clear expected count to hide spinner
          setPollAttempts(0); // Reset for next time
          setLastPhaseCount(0); // Reset
          console.log('[SubscriptionResults] Polling stopped');
        } else {
          // Continue polling
          setLastPhaseCount(currentPhaseCount);
          setExpectedPhaseCount(currentPhaseCount || 1);
          setPollAttempts(prev => prev + 1);
          setTimeout(fetchData, 1000);
        }
      })
      .catch((err) => {
        setError(err.message || "Unknown error");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId, customerId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
          <div className="relative">
            <div className="h-12 w-12 rounded-full border-4 border-muted"></div>
            <div className="absolute top-0 left-0 h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sm text-muted-foreground">Loading your subscription...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Error Loading Subscription</CardTitle>
          <CardDescription>{error || "Unknown error occurred"}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { nextInvoice, schedule, priceMetadata = {} } = data;
  const currency = nextInvoice?.currency || "USD";

  // Create lookup with colors based on server-provided metadata
  const priceLookup = new Map<string, { name: string; color: string }>();
  Object.entries(priceMetadata).forEach(([priceId, meta]) => {
    priceLookup.set(priceId, {
      name: meta.name,
      color: meta.type === 'base' ? "text-blue-600" : "text-green-600"
    });
  });

  return (
    <div className="space-y-6">
      {/* Success header */}
      <Card className="border-green-200 bg-green-50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
            <div>
              <CardTitle className="text-green-900">Subscription Active!</CardTitle>
              <CardDescription className="text-green-700">
                Your trash valet service is now scheduled
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Next Invoice Preview */}
      {nextInvoice && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Next Invoice Preview
            </CardTitle>
            <CardDescription>
              Upcoming charges for your subscription
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Amount Due</span>
              <span className="text-2xl font-bold">
                {money(nextInvoice.amount_due, currency)}
              </span>
            </div>
            
            {nextInvoice.next_payment_attempt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Payment Date</span>
                <span className="font-medium">
                  {formatDateTime(nextInvoice.next_payment_attempt)}
                </span>
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Line Items</h4>
              {nextInvoice.lines.map((line, idx) => {
                const priceInfo = line.price ? priceLookup.get(line.price) : null;
                return (
                  <div key={idx} className="flex items-start justify-between text-sm">
                    <div className="flex-1">
                      <div className={`font-medium ${priceInfo?.color || ""}`}>
                        {priceInfo?.name || "Service"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Qty: {line.quantity} × {money(line.amount || 0, currency)}
                      </div>
                      {line.period.start && line.period.end && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDate(line.period.start)} – {formatDate(line.period.end)}
                        </div>
                      )}
                    </div>
                    <div className="font-medium">
                      {money((line.quantity || 0) * (line.amount || 0), currency)}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Schedule Timeline */}
      {schedule ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Subscription Schedule
            </CardTitle>
            <CardDescription>
              How your pricing changes throughout the year
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {expectedPhaseCount && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="h-5 w-5 rounded-full border-2 border-muted"></div>
                  <div className="absolute top-0 left-0 h-5 w-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></div>
                </div>
                <div className="text-sm">
                  <div className="font-medium text-blue-900">Building your schedule...</div>
                  <div className="text-blue-700 text-xs">
                    Loading phases ({schedule.phases.length} of ~{expectedPhaseCount} loaded)
                  </div>
                </div>
              </div>
            )}
            
            {schedule.current_phase && (
              <div className="rounded-lg bg-blue-50 p-3 text-sm">
                <div className="font-medium text-blue-900 mb-1">Current Phase</div>
                <div className="text-blue-700">
                  {formatDate(schedule.current_phase.start)} – {formatDate(schedule.current_phase.end)}
                </div>
              </div>
            )}

            <Separator />

            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Schedule Phases</h4>
              {schedule.phases.map((phase, idx) => {
                const isLast = idx === schedule.phases.length - 1;
                const isOpenEnded = isLast && schedule.last_phase_open_ended;
                
                // Identify base and seasonal items using price metadata
                const baseItem = phase.items.find((item) => 
                  item.price && priceMetadata[item.price]?.type === 'base'
                );
                const seasonalItem = phase.items.find((item) => 
                  item.price && priceMetadata[item.price]?.type === 'seasonal'
                );

                // Calculate total monthly cost
                let totalMonthlyCost = 0;
                if (baseItem?.price && priceMetadata[baseItem.price]) {
                  totalMonthlyCost += (priceMetadata[baseItem.price].amount * baseItem.quantity);
                }
                if (seasonalItem?.price && priceMetadata[seasonalItem.price]) {
                  totalMonthlyCost += (priceMetadata[seasonalItem.price].amount * seasonalItem.quantity);
                }

                return (
                  <div
                    key={idx}
                    className="rounded-lg border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="text-sm font-medium">
                        Phase {idx + 1}
                        {isOpenEnded && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (Ongoing)
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-blue-600">
                          {money(totalMonthlyCost)}/month
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {phase.start && phase.end ? (
                            <>{formatDate(phase.start)} – {formatDate(phase.end)}</>
                          ) : isOpenEnded ? (
                            "No end date"
                          ) : (
                            `Until ${formatDate(phase.end)}`
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1 text-sm">
                      {baseItem && (
                        <div className="flex items-center justify-between">
                          <span className="text-blue-600">Base Service</span>
                          <span className="font-medium">
                            {baseItem.quantity} {baseItem.quantity === 1 ? "property" : "properties"}
                          </span>
                        </div>
                      )}
                      {seasonalItem && (
                        <div className="flex items-center justify-between">
                          <span className="text-green-600">Seasonal Add-on</span>
                          <span className="font-medium">
                            {seasonalItem.quantity} {seasonalItem.quantity === 1 ? "property" : "properties"}
                          </span>
                        </div>
                      )}
                      {!seasonalItem && (
                        <div className="text-xs text-muted-foreground italic">
                          No seasonal service in this period
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {schedule.last_phase_open_ended && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm">
                <div className="font-medium text-amber-900 mb-1">
                  <MapPin className="inline h-4 w-4 mr-1" />
                  Flexible Schedule
                </div>
                <div className="text-amber-700 text-xs">
                  Your subscription will continue with base service. Seasonal add-ons will activate automatically when properties enter their seasonal windows.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <Clock className="h-5 w-5" />
              Schedule Being Created
            </CardTitle>
            <CardDescription className="text-amber-700">
              Your subscription schedule is being set up. This usually takes a few seconds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <div className="h-6 w-6 rounded-full border-2 border-amber-300"></div>
                <div className="absolute top-0 left-0 h-6 w-6 rounded-full border-2 border-amber-600 border-t-transparent animate-spin"></div>
              </div>
              <p className="text-sm text-amber-800">
                The webhook is processing your subscription and building the schedule phases...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Subscription Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subscription ID</span>
            <span className="font-mono text-xs">{data.subscriptionId}</span>
          </div>
          {schedule && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Schedule ID</span>
              <span className="font-mono text-xs">{schedule.id}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
