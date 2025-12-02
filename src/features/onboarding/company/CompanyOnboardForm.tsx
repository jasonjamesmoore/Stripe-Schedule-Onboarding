"use client";

import {
  useForm,
  useFieldArray,
  useWatch,
  type SubmitHandler,
} from "react-hook-form";


import {
  stepResolver,
  type FormValues,
  type WizardContext,
} from "./company.step-resolver";
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
import { useState } from "react";
import {
  type Plan,
} from "@/features/payments/stripe/shared/plan";
import { PaymentStep } from "@/features/payments/stripe/client/PaymentStep";

// Potential props to set initial business type

// type Props = {
//   initialBusinessType?: "sole_prop" | "company";
//   lockBusinessType?: boolean;
// };

const steps = [
  "Business & Contact Information",
  "Service Addresses",
  "Payment",
  "You're All Set!",
] as const;
type Step = 0 | 1 | 2 | 3;

/** Only validate fields for the current step when advancing */
export function CompanyOnboardForm() {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);

  const form = useForm<FormValues, WizardContext>({
    resolver: stepResolver,
    context: { step },
    mode: "onSubmit",
    reValidateMode: "onChange",
    shouldUnregister: false,
    shouldFocusError: true,
    defaultValues: {
      plan: "trash",
      business: { legalName: "", dba: "", ein: "", businessType: "sole_prop" },
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
        // removed serviceSameAsBilling UX; rely on services only
        services: [],
      },
      // team: [],
      agreeToTerms: false,
    },
  });

  const { control } = form;
  const bType = useWatch({ control, name: "business.businessType" });
  const email = useWatch({ control, name: "contact.email" });
  const selectedPlan = useWatch({ control, name: "plan" }) as Plan | undefined;
  const services = useWatch({ control, name: "addresses.services" }) as
    | FormValues["addresses"]["services"]
    | undefined;
  const agreed = useWatch({ control, name: "agreeToTerms" }) as
    | boolean
    | undefined;

  // Team field array
  // const {
  //   fields: teamFields,
  //   append: appendTeam,
  //   remove: removeTeam,
  // } = useFieldArray({ control, name: "team" });

  // Service addresses field array
  const {
    fields: serviceFields,
    append: appendService,
    remove: removeService,
  } = useFieldArray({ control, name: "addresses.services" });

  // const [editingTeam, setEditingTeam] = useState<number | null>(null);
  const [editingService, setEditingService] = useState<number | null>(null);

  const back = () => setStep((s) => (s > 0 ? ((s - 1) as Step) : s));

  const onSubmit: SubmitHandler<FormValues> = () => {
    // No-op: finalization happens via Stripe webhook after successful payment.
  };

  // const onSubmit: SubmitHandler<FormValues> = (values) => {
  //   console.log("[onSubmit] ENTER", { step, values });
  //   if (step !== 3) return; // only submit on last step
  //   try {
  //     const parsed = OnboardingSchema.safeParse(values);
  //     if (!parsed.success) {
  //       const map = collectErrorsFromTree(treeify(parsed.error));

  //       if (map[""]?.[0]) {
  //         form.setError("root", { type: "zod", message: map[""][0] });
  //       }

  //       for (const [path, messages] of Object.entries(map)) {
  //         if (!path) continue;
  //         const msg = messages[0];
  //         if (msg) {
  //           form.setError(path as FieldPath<FormValues>, {
  //             type: "zod",
  //             message: msg,
  //           });
  //         }
  //       }
  //       return;
  //     }
  //     const data = parsed.data;
  //     console.log("Submitting Payload:", data);
  //     // API CALL LIVES HERE
  //   } catch (error) {
  //     console.error("Submit Failed:", error);
  //   }
  // };

  /** progress width % */
  const progress = ((step + 1) / steps.length) * 100;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
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

        {/* ===== STEP 1: Business + Billing + Contact ===== */}
        {step === 0 && (
          <div className="space-y-8">
            {/* Business */}
            <div className="flex text-xl font-semibold">
              Business Information
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={control}
                name="business.businessType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Type</FormLabel>
                    <FormControl>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3"
                        value={field.value}
                        onChange={field.onChange}
                      >
                        <option value="sole_prop">
                          Individual/Sole Proprietor
                        </option>
                        <option value="company">Company/Corporation</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="business.legalName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Legal Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="business.dba"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>DBA (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name="business.ein"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      EIN {bType === "company" ? "" : "(optional)"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="12-3456789"
                        inputMode="numeric"
                        pattern="[0-9\-]*"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Contact */}
            <div className="flex text-xl font-semibold">Point of Contact</div>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {serviceFields.map((s, idx) => {
                const isEditing = editingService === idx;
                const prefix = `addresses.services.${idx}` as const;
                const title =
                  form.getValues(`${prefix}.line1`) ||
                  form.getValues(`${prefix}.city`) ||
                  "New Service Address";

                return (
                  <Card key={s.id} className="h-full flex flex-col">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-base">
                        {isEditing ? "Edit Service Address" : title}
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

        {/* ===== STEP 3: Payment (mirror Personal) ===== */}
        {step === 2 && (
          <div className="space-y-6">
            {/* Stripe Payment (passes per-address multiplier) */}
            <PaymentStep
              email={email || undefined}
              plan={selectedPlan}
              services={services ?? []}
              canPay={Boolean(agreed) && serviceFields.length > 0}
              onSuccess={() => setStep(3 as Step)}
              account="business"
            />

            <Separator />

            {/* Terms (checkbox after PaymentStep, like Personal) */}
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

            {/* Helpful hint when no addresses yet (exactly like Personal) */}
            {serviceFields.length < 1 && (
              <p className="text-xs text-muted-foreground">
                Add at least one service address to enable payment.
              </p>
            )}

            <Separator />
          </div>
        )}

        {/* ===== STEP 4: Success / Thank you ===== */}
        {step === 3 && (
          <div className="mx-auto max-w-xl text-center space-y-6 py-10">
            <div className="text-2xl font-semibold">🎉 Payment Successful</div>
            <p className="text-muted-foreground">
              Thanks! Your subscription is active. We’ll start service on
              your property’s trash collection schedule.
              
            </p>

            {/* Optional buttons to route somewhere helpful */}
            {/* <div className="grid gap-3">
      <Button className="bg-[#254B58] text-[#FCCF86]" type="button">
        Go to My Account
      </Button>
      <Button variant="outline" type="button">
        Back to Home
      </Button>
    </div> */}
          </div>
        )}

        {/* Wizard controls */}
        {step !== 3 && ( // hide all controls on the success screen
          <div className="flex items-center justify-between pt-4">
            {/* Back */}
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={back}
                disabled={form.formState.isSubmitting}
                aria-disabled={form.formState.isSubmitting}
              >
                Back
              </Button>
            ) : (
              <span />
            )}

            {/* Next / Payment-slot (no final Submit) */}
            {step < steps.length - 1 ? (
              step === 2 ? (
                // Payment step: PaymentStep can render its own primary action via portal
                <div id="wizard-next-slot" />
              ) : (
                <Button
                  className="bg-[#254B58] text-[#FCCF86]"
                  type="button"
                  onClick={() =>
                    form.handleSubmit(
                      () => setStep((s) => (s + 1) as Step),
                      (errors) => console.log("[Next] INVALID", errors)
                    )()
                  }
                  disabled={
                    form.formState.isSubmitting || form.formState.isValidating
                  }
                  aria-disabled={
                    form.formState.isSubmitting || form.formState.isValidating
                  }
                >
                  {form.formState.isValidating ? "Checking…" : "Next"}
                </Button>
              )
            ) : null}
          </div>
        )}
      </form>
    </Form>
  );
}

// {/* ===== STEP 4: Team Members ===== */}
//         {step === 3 && (
//           <div className="space-y-3">
//             <div className="flex items-center justify-between">
//               <span className="text-sm font-medium">Team Members</span>
//               <Button
//                 type="button"
//                 variant="outline"
//                 onClick={() => appendTeam({ name: "", email: "", role: "" })}
//                 className="gap-2"
//               >
//                 <Plus className="h-4 w-4" />
//                 Add member
//               </Button>
//             </div>

//             <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
//               {teamFields.map((m, idx) => {
//                 const isEditing = editingTeam === idx;
//                 return (
//                   <Card key={m.id} className="h-full flex flex-col">
//                     <CardHeader className="flex flex-row items-center justify-between space-y-0">
//                       <CardTitle className="text-base">
//                         {isEditing
//                           ? "Edit Team Member"
//                           : form.getValues(`team.${idx}.name`) || "New Member"}
//                       </CardTitle>
//                       <div className="flex gap-1">
//                         <Button
//                           type="button"
//                           variant="ghost"
//                           size="icon"
//                           onClick={() => setEditingTeam(isEditing ? null : idx)}
//                           aria-label={isEditing ? "Done" : "Edit"}
//                         >
//                           <Pencil className="h-4 w-4" />
//                         </Button>
//                         <Button
//                           type="button"
//                           variant="ghost"
//                           size="icon"
//                           onClick={() => {
//                             removeTeam(idx);
//                             if (editingTeam === idx) setEditingTeam(null);
//                           }}
//                           aria-label="Remove"
//                         >
//                           <Trash2 className="h-4 w-4" />
//                         </Button>
//                       </div>
//                     </CardHeader>

//                     <Separator />

//                     <CardContent className="flex-1 pt-4">
//                       {isEditing ? (
//                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//                           <FormField
//                             control={control}
//                             name={`team.${idx}.name`}
//                             render={({ field }) => (
//                               <FormItem>
//                                 <FormLabel>Name</FormLabel>
//                                 <FormControl>
//                                   <Input {...field} />
//                                 </FormControl>
//                                 <FormMessage />
//                               </FormItem>
//                             )}
//                           />
//                           <FormField
//                             control={control}
//                             name={`team.${idx}.email`}
//                             render={({ field }) => (
//                               <FormItem>
//                                 <FormLabel>Email</FormLabel>
//                                 <FormControl>
//                                   <Input type="email" {...field} />
//                                 </FormControl>
//                                 <FormMessage />
//                               </FormItem>
//                             )}
//                           />
//                           <FormField
//                             control={control}
//                             name={`team.${idx}.role`}
//                             render={({ field }) => (
//                               <FormItem className="md:col-span-2">
//                                 <FormLabel>Role (optional)</FormLabel>
//                                 <FormControl>
//                                   <Input {...field} />
//                                 </FormControl>
//                                 <FormMessage />
//                               </FormItem>
//                             )}
//                           />
//                         </div>
//                       ) : (
//                         <div className="text-sm text-muted-foreground">
//                           <div>
//                             <span className="font-medium">Name:</span>{" "}
//                             {form.getValues(`team.${idx}.name`) || "—"}
//                           </div>
//                           <div>
//                             <span className="font-medium">Email:</span>{" "}
//                             {form.getValues(`team.${idx}.email`) || "—"}
//                           </div>
//                         </div>
//                       )}
//                     </CardContent>

//                     {isEditing && (
//                       <CardFooter className="mt-auto justify-end gap-2">
//                         <Button
//                           type="button"
//                           variant="outline"
//                           onClick={() => setEditingTeam(null)}
//                         >
//                           Done
//                         </Button>
//                       </CardFooter>
//                     )}
//                   </Card>
//                 );
//               })}
//             </div>
//           </div>
//         )}

// {/* Wizard controls */}
//         <div className="flex items-center justify-between pt-4">
//           {/* Back */}
//           {step > 0 ? (
//             <Button
//               type="button"
//               variant="outline"
//               onClick={back}
//               disabled={form.formState.isSubmitting}
//             >
//               Back
//             </Button>
//           ) : (
//             <span />
//           )}

//           {/* Next / Submit */}
//           {step < steps.length - 1 ? (
//             step === 2 ? (
//               // Payment step: render a slot for PaymentStep to fill via a portal
//               <div id="wizard-next-slot" />
//             ) : (
//               <Button
//                 className="bg-[#254B58] text-[#FCCF86]"
//                 type="button"
//                 // validate ONLY the current step via the step-aware resolver
//                 onClick={() =>
//                   form.handleSubmit(
//                     () => setStep((s) => (s + 1) as Step),
//                     (errors) => console.log("[Next] INVALID", errors)
//                   )()
//                 } // on invalid -> RHF focuses the first error
//                 disabled={
//                   form.formState.isSubmitting || form.formState.isValidating
//                 }
//               >
//                 {form.formState.isValidating ? "Checking…" : "Next"}
//               </Button>
//             )
//           ) : (
//             <Button
//               type="button"
//               onClick={form.handleSubmit(onSubmit, (errors) =>
//                 console.log("[Submit] INVALID:", errors)
//               )}
//               disabled={form.formState.isSubmitting}
//             >
//               {form.formState.isSubmitting ? "Submitting…" : "Submit"}
//             </Button>
//           )}
//         </div>
