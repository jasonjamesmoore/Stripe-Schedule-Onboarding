"use client";

import {
  useForm,
  useFieldArray,
  useWatch,
  type SubmitHandler,
} from "react-hook-form";

import {
  resolveRuleForAddress,
  type Address as SAAddress,
  // type Weekday,
} from "@/lib/serviceAreas/serviceAreas";

import {
  stepResolver,
  type FormValues,
  type WizardContext,
} from "./personal.step-resolver";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Pencil, Trash2, Plus } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import type { Plan } from "@/features/payments/stripe/shared/plan";


//  Stripe payment step
import { PaymentStep } from "@/features/payments/stripe/client/PaymentStep";
import { SubscriptionResults } from "@/features/payments/stripe/client/SubscriptionResults";
import { DemoGuide } from "@/components/demo/DemoGuide";

const steps = [
  "Billing & Contact Information",
  "Service Addresses - We'll Roll your Trash Cans at these locations.",
  "Service Plan & Payment",
  "You're all Set!",
] as const;
type Step = 0 | 1 | 2 | 3;

const eqAddr = (
  a?: FormValues["addresses"]["billing"],
  b?: FormValues["addresses"]["billing"]
) => {
  const n = (s?: string) => (s ?? "").trim();
  return (
    n(a?.line1) === n(b?.line1) &&
    n(a?.line2) === n(b?.line2) &&
    n(a?.city) === n(b?.city) &&
    n(a?.state) === n(b?.state) &&
    n(a?.postalCode) === n(b?.postalCode) &&
    (a?.country ?? "US") === (b?.country ?? "US")
  );
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function toSAAddress(svc: {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}): SAAddress {
  return {
    line1: svc.line1 ?? "",
    city: svc.city ?? "",
    state: svc.state ?? "",
    zip: (svc.postalCode ?? "").trim(),
  };
}

export function PersonalOnboardForm() {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  // Track the auto-created service card (when "same as billing" is turned on)
  const [autoServiceId, setAutoServiceId] = useState<string | null>(null);
  // Internal flag to know we're waiting for the append to surface in `serviceFields`
  const pendingAutoFromBilling = useRef(false);
  const pendingBillingSnapshot = useRef<
    FormValues["addresses"]["billing"] | null
  >(null);

  // Track subscription ID after successful payment
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const form = useForm<FormValues, WizardContext>({
    resolver: stepResolver,
    context: { step },
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldUnregister: false,
    shouldFocusError: true,
    defaultValues: {
      plan: "trash",
      contact: { firstName: "", lastName: "", email: "", phone: "" },
      addresses: {
        billing: {
          line1: "",
          line2: "",
          city: "",
          state: "",
          postalCode: "",
          country: "US",
        },
        serviceSameAsBilling: false,
        services: [],
      },
      team: [],
      agreeToTerms: false,
    },
  });

  const { control } = form;

  // Service addresses field array
  const {
    fields: serviceFields,
    append: appendService,
    remove: removeService,
  } = useFieldArray({ control, name: "addresses.services" });

  // Pre-fill demo data function
  const fillDemoData = () => {
    // Generate unique email with timestamp
    const timestamp = Date.now();
    const email = `demo+${timestamp}@example.com`;
    
    // Fill contact info
    form.setValue("contact.firstName", "Demo");
    form.setValue("contact.lastName", "User");
    form.setValue("contact.email", email);
    form.setValue("contact.phone", "555-0100");
    
    // Fill billing address
    form.setValue("addresses.billing.line1", "123 Demo Street");
    form.setValue("addresses.billing.city", "Wilmington");
    form.setValue("addresses.billing.state", "NC");
    form.setValue("addresses.billing.postalCode", "28401");
    form.setValue("addresses.billing.country", "US");
    
    // Clear existing services first
    while (serviceFields.length > 0) {
      removeService(0);
    }
    
    // Add demo service addresses
    appendService({
      line1: "456 Beach Road",
      line2: "",
      city: "Topsail Beach",
      state: "NC",
      postalCode: "28445",
      country: "US",
    });
    
    appendService({
      line1: "789 Ocean Drive",
      line2: "",
      city: "North Topsail Beach",
      state: "NC",
      postalCode: "28460",
      country: "US",
    });
    
    appendService({
      line1: "321 Main Street",
      line2: "",
      city: "Wilmington",
      state: "NC",
      postalCode: "28401",
      country: "US",
    });
  };

  // Watch fields needed by PaymentStep
  const email = useWatch({ control, name: "contact.email" });
  const selectedPlan = useWatch({ control, name: "plan" }) as Plan | undefined;
  const agreed = useWatch({ control, name: "agreeToTerms" }) as
    | boolean
    | undefined;
  const serviceSameAsBilling = useWatch({
    control,
    name: "addresses.serviceSameAsBilling",
  }) as boolean | undefined;
  const billing = useWatch({ control, name: "addresses.billing" });
  const services = useWatch({ control, name: "addresses.services" }) as
    | FormValues["addresses"]["services"]
    | undefined;
  const serviceCount = services?.length ?? 0;
  // const [editingTeam, setEditingTeam] = useState<number | null>(null);
  const [editingService, setEditingService] = useState<number | null>(null);

  useEffect(() => {
    if (!serviceSameAsBilling) return;
    const b = billing;
    if (!b) return;

    // if already have/track the auto card and it still exists, do nothing
    if (autoServiceId && serviceFields.some((f) => f.id === autoServiceId))
      return;

    // try to adopt an existing card that equals billing (user may have added it manually)
    const match = serviceFields.find((f, idx) => {
      const v = form.getValues(`addresses.services.${idx}` as const);
      return eqAddr(v as FormValues["addresses"]["billing"], b);
    });

    if (match) {
      setAutoServiceId(match.id);
      return;
    }

    // otherwise append a fresh copy of billing and capture it in the next effect
    pendingBillingSnapshot.current = b;
    pendingAutoFromBilling.current = true;
    appendService({
      line1: b.line1 ?? "",
      line2: b.line2 ?? "",
      city: b.city ?? "",
      state: b.state ?? "",
      postalCode: b.postalCode ?? "",
      country: b.country ?? "US",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceSameAsBilling]);

  useEffect(() => {
    if (!pendingAutoFromBilling.current) return;
    const snap = pendingBillingSnapshot.current;
    if (!snap) return;

    const m = serviceFields.find((f, idx) => {
      const v = form.getValues(`addresses.services.${idx}` as const);
      return eqAddr(v as FormValues["addresses"]["billing"], snap);
    });

    if (m) {
      setAutoServiceId(m.id);
      pendingAutoFromBilling.current = false;
      pendingBillingSnapshot.current = null;
    }
  }, [serviceFields, form]);

  useEffect(() => {
    if (serviceSameAsBilling) return;

    // clean any in-flight append bookkeeping
    pendingAutoFromBilling.current = false;
    pendingBillingSnapshot.current = null;

    if (autoServiceId) {
      const idx = serviceFields.findIndex((f) => f.id === autoServiceId);
      if (idx >= 0) {
        removeService(idx);
        if (editingService === idx) setEditingService(null);
      }
      setAutoServiceId(null);
      return;
    }

    // (optional safety) if not tracking an id but there's exactly one card
    // and it equals billing, remove it.
    if (serviceFields.length === 1 && billing) {
      const only = form.getValues("addresses.services.0" as const);
      const same = eqAddr(only as FormValues["addresses"]["billing"], billing);
      if (same) {
        removeService(0);
        if (editingService === 0) setEditingService(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceSameAsBilling, autoServiceId, serviceFields]);

  const back = () => setStep((s) => (s > 0 ? ((s - 1) as Step) : s));

  const onSubmit: SubmitHandler<FormValues> = () => {
    // No-op: finalization happens via Stripe PaymentStep success + webhook.
  };

  /** progress width % */
  const progress = ((step + 1) / steps.length) * 100;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, (errors) => {
          console.log("[handleSubmit] INVALID:", errors);
        })}
        className="mx-auto max-w-5xl space-y-8"
      >
        {/* Step header + progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{steps[step]}</div>
            <div className="text-xs text-muted-foreground">
              Step {step + 1} of {steps.length}
            </div>
          </div>
          <div className="h-1 w-full rounded bg-muted">
            <Progress
              indicatorClassName="bg-linear-to-r from-[#234854] to-[#60C9EC]"
              value={progress}
            />
          </div>
        </div>

        {/* ===== STEP 1: Member Billing + Contact ===== */}
        {step === 0 && (
          <div className="space-y-8">
            {/* Demo Data Button */}
            <div className="rounded-lg bg-gradient-to-r from-blue-50 to-green-50 border-2 border-blue-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-blue-900 mb-1">
                    🚀 Quick Demo
                  </div>
                  <div className="text-sm text-blue-700">
                    Auto-fill with test data to see seasonal pricing in action
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={fillDemoData}
                  variant="default"
                  className="bg-gradient-to-r from-[#234854] to-[#60C9EC] hover:opacity-90"
                >
                  Fill Demo Data
                </Button>
              </div>
            </div>
            
            {/* Contact */}
            <div className="flex text-xl font-semibold">Member Information</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={control}
                name="contact.firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="contact.lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="contact.email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="contact.phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Billing Address */}
            <div className="flex text-xl font-semibold">Billing Address</div>
            <fieldset className="space-y-4">
              <FormField
                control={control}
                name="addresses.billing.line1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Billing Address - Line 1</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="addresses.billing.line2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Line 2</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={control}
                  name="addresses.billing.city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="addresses.billing.state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State (2-letter)</FormLabel>
                      <FormControl>
                        <Input maxLength={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="addresses.billing.postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </fieldset>
          </div>
        )}

        {/* ===== STEP 2: Service Addresses (cards) ===== */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Service Addresses - (min. 1 required)
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  appendService({
                    line1: "",
                    line2: "",
                    city: "",
                    state: "",
                    postalCode: "",
                    country: "US",
                  })
                }
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add address
              </Button>
            </div>

            {/* Same-as-billing toggle remains, but no longer hides the grid */}
            <FormField
              control={control}
              name="addresses.serviceSameAsBilling"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      checked={Boolean(field.value)}
                      onCheckedChange={(v) => field.onChange(Boolean(v))}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">
                    Service address is the same as billing
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Optional hint */}
            {serviceSameAsBilling && (
              <p className="text-xs text-muted-foreground">
                Address added automatically. You can still add or edit.
              </p>
            )}

            {/* Always show the grid of real, editable cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {serviceFields.map((s, idx) => {
                const isEditing = editingService === idx;
                const prefix = `addresses.services.${idx}` as const;
                const title =
                  form.getValues(`${prefix}.line1`) ||
                  form.getValues(`${prefix}.city`) ||
                  "New Service Address";

                const isAuto = Boolean(
                  serviceSameAsBilling && autoServiceId === s.id
                );

                return (
                  <Card key={s.id} className="h-full flex flex-col">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-base">
                        {isEditing ? "Edit Service Address" : title}
                        {isAuto && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
                            from billing
                          </span>
                        )}
                      </CardTitle>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setEditingService(isEditing ? null : idx)
                          }
                          aria-label={isEditing ? "Done" : "Edit"}
                          disabled={isAuto}
                          title={isAuto ? "Disable 'same as billing'" : "Edit"}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            removeService(idx);
                            if (editingService === idx) setEditingService(null);
                          }}
                          aria-label="Remove"
                          disabled={isAuto}
                          title={
                            isAuto
                              ? "Disable 'same as billing' to remove this address"
                              : "Remove"
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>

                    <Separator />

                    <CardContent className="flex-1 pt-4">
                      {isEditing ? (
                        <div className="space-y-4">
                          <FormField
                            control={control}
                            name={`${prefix}.line1`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Line 1</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={control}
                            name={`${prefix}.line2`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Line 2</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <FormField
                              control={control}
                              name={`${prefix}.city`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>City</FormLabel>
                                  <FormControl>
                                    <Input {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={control}
                              name={`${prefix}.state`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>State (2-letter)</FormLabel>
                                  <FormControl>
                                    <Input maxLength={2} {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={control}
                              name={`${prefix}.postalCode`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>ZIP</FormLabel>
                                  <FormControl>
                                    <Input {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground space-y-1">
                          <div>
                            <span className="font-medium">Line 1:</span>{" "}
                            {form.getValues(`${prefix}.line1`) || "—"}
                          </div>
                          <div>
                            <span className="font-medium">Line 2:</span>{" "}
                            {form.getValues(`${prefix}.line2`) || "—"}
                          </div>
                          <div>
                            <span className="font-medium">City/State/ZIP:</span>{" "}
                            {[
                              form.getValues(`${prefix}.city`) || "—",
                              form.getValues(`${prefix}.state`) || "—",
                              form.getValues(`${prefix}.postalCode`) || "—",
                            ].join(", ")}
                          </div>
                          <div>
                            <span className="font-medium">Country:</span>{" "}
                            {form.getValues(`${prefix}.country`) || "US"}
                          </div>

                          {(() => {
                            const svc = {
                              line1: form.getValues(`${prefix}.line1` as const),
                              city: form.getValues(`${prefix}.city` as const),
                              state: form.getValues(`${prefix}.state` as const),
                              postalCode: form.getValues(
                                `${prefix}.postalCode` as const
                              ),
                            };
                            const rule = resolveRuleForAddress(
                              toSAAddress(svc)
                            );

                            if (!rule) {
                              return (
                                <div className="text-xs text-red-600 mt-2">
                                  Not in a supported service area yet (check
                                  City/ZIP).
                                </div>
                              );
                            }

                            return (
                              <div className="text-xs mt-2">
                                <div>
                                  Base pickup:{" "}
                                  <span className="font-medium">
                                    {DOW[rule.baseDay]}
                                  </span>
                                </div>
                                {rule.secondaryDay != null && (
                                  <div>
                                    2nd pickup:{" "}
                                    <span className="font-medium">
                                      {DOW[rule.secondaryDay]}
                                    </span>
                                    {rule.season && (
                                      <span className="ml-1 text-muted-foreground">
                                        (
                                        {new Date(
                                          rule.season.startUTC * 1000
                                        ).toLocaleDateString()}
                                        {" – "}
                                        {new Date(
                                          rule.season.endUTC * 1000
                                        ).toLocaleDateString()}
                                        )
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </CardContent>

                    {isEditing && (
                      <CardFooter className="mt-auto justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEditingService(null)}
                        >
                          Done
                        </Button>
                      </CardFooter>
                    )}
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== STEP 3: Payment ===== */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Stripe Payment (passes per-address multiplier) */}
            <PaymentStep
              email={email || undefined}
              plan={selectedPlan}
              services={services ?? []}
              canPay={Boolean(agreed) && serviceCount > 0}
              onSuccess={(subId, custId) => {
                setSubscriptionId(subId || null);
                setCustomerId(custId || null);
                setStep(3 as Step);
              }}
              account="individual"
            />
            <Separator />
            {/* Terms */}
            <FormField
              control={control}
              name="agreeToTerms"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(Boolean(v))}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">
                    I agree to the terms
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Helpful hint when no addresses yet */}
            {serviceCount < 1 && (
              <p className="text-xs text-muted-foreground">
                Add at least one service address to enable payment.
              </p>
            )}

            <Separator />
          </div>
        )}

        {/* ===== STEP 4: Success / Thank you ===== */}
        {step === 3 && (
          <div className="mx-auto max-w-3xl space-y-6">
            <SubscriptionResults
              subscriptionId={subscriptionId || undefined}
              customerId={customerId || undefined}
            />
          </div>
        )}
        {step !== 3 && ( // hide all controls on the success screen
          <div className="flex items-center justify-between pt-4">
            {/* Back */}
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={back}
                disabled={form.formState.isSubmitting}
              >
                Back
              </Button>
            ) : (
              <span />
            )}

            {/* Next / Payment-slot (no final Submit) */}
            {
              step < steps.length - 1 ? (
                step === 2 ? (
                  // Payment step: PaymentStep can render its own primary action via portal
                  <div id="wizard-next-slot" />
                ) : (
                  <Button
                    className="bg-[#254B58] text-[#FCCF86]"
                    type="button"
                    onClick={() =>
                      form.handleSubmit(
                        () => {
                          if (step === 1) {
                            const svcs =
                              form.getValues("addresses.services") ?? [];
                            const failures: number[] = [];
                            svcs.forEach((svc, idx) => {
                              const rule = resolveRuleForAddress(
                                toSAAddress(svc)
                              );
                              if (!rule) failures.push(idx);
                            });

                            if (failures.length) {
                              // Surface a simple field error on the first failing card
                              const i = failures[0];
                              form.setError(
                                `addresses.services.${i}.city` as const,
                                {
                                  type: "validate",
                                  message:
                                    "We don’t service this area yet. Check city/ZIP.",
                                }
                              );
                              console.warn(
                                "[service area] unresolved indexes:",
                                failures
                              );
                              return; // DO NOT advance
                            }
                          }
                          setStep((s) => (s + 1) as Step); // OK to advance
                        },
                        (errors) => console.log("[Next] INVALID", errors)
                      )()
                    }
  
                    disabled={
                      form.formState.isSubmitting || form.formState.isValidating
                    }
                  >
                    {form.formState.isValidating ? "Checking…" : "Next"}
                  </Button>
                )
              ) : null /* Previously the "Submit" button lived here. Now it's gone. */
            }
          </div>
        )}
      </form>
      
      {/* Demo Guide - visible throughout */}
      <DemoGuide />
    </Form>
  );
}

