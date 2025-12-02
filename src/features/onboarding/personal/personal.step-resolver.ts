import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";

import {
  OnboardingSchema,  
  AddressSchema,
  // TeamMemberSchema,    
  email,
  phone,
  trimmed,
} from "./personal.schema";
import { PLAN_VALUES } from "@/features/payments/stripe/shared/plan";

/** Types shared with the form */
export type FormValues = z.input<typeof OnboardingSchema>;
export type Step = 0 | 1 | 2 | 3;             // 3 = success (no validation)
export type WizardContext = { step: Step };

/** Reusable shape for step-level address validation */
const AddressesStepShape = z.object({
  serviceSameAsBilling: z.boolean().default(false),
  billing: AddressSchema,
  services: z.array(AddressSchema).default([]),
});

export const Step0Schema = z.object({
  contact: z.object({
    firstName: trimmed.min(1, "First name is required"),
    lastName: trimmed.min(1, "Last name is required"),
    email,
    phone,
  }),
  addresses: AddressesStepShape,
});

export const Step1Schema = z
  .object({
    addresses: AddressesStepShape,
  })
  .refine(
    ({ addresses }) =>
      addresses.serviceSameAsBilling || (addresses.services?.length ?? 0) > 0,
    {
      path: ["addresses", "services"],
      message:
        "Add at least one service address or check 'service address is the same as billing'.",
    }
  );

/** Base step-2 schema (plan + terms) */
const Step2Base = z.object({
  plan: z.enum(PLAN_VALUES), // stays in lockstep with shared Plan
  agreeToTerms: z.boolean().refine(Boolean, "You must accept the terms"),
});

/** Factory to add cross-step guards on step 2 (uses full form values) */
const makeStep2Schema = (all: FormValues) =>
  Step2Base.superRefine((_, ctx) => {
    const hasService =
      all.addresses?.serviceSameAsBilling ||
      ((all.addresses?.services?.length ?? 0) > 0);

    if (!hasService) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agreeToTerms"], // anchor the error somewhere visible on step 2
        message: "Add at least one service address before paying.",
      });
    }
  });

/** Typed tuple of the “plain” step schemas (0–1). Step 2 is built dynamically. */
export const stepSchemas = [Step0Schema, Step1Schema] as const;

/**
 * Step-aware resolver:
 * - Steps 0–1: validate only those parts.
 * - Step 2: validate plan/terms + cross-step “has service address” guard.
 * - Step 3 (success): skip validation entirely.
 * Returns original values so other fields aren't stripped.
 */
export const stepResolver: Resolver<FormValues, WizardContext> = async (
  values,
  ctx,
  opts
) => {
  const step = (ctx?.step ?? 0) as Step;

  // Success screen: no validation
  if (step === 3) return { values, errors: {} };

  // Build the appropriate schema per step
  const schema =
    step === 0
      ? stepSchemas[0]
      : step === 1
      ? stepSchemas[1]
      : makeStep2Schema(values); // step === 2

  const base = zodResolver(schema) as unknown as Resolver<FormValues, WizardContext>;
  const result = await base(values, ctx, opts);

  return { values, errors: result.errors };
};
