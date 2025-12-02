import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { PLAN_VALUES } from "@/features/payments/stripe/shared/plan";
import {
  AddressSchema,
  email,
  phone,
  trimmed,
  // TeamMemberSchema,
} from "./company.schema"; // adjust the re-exports if needed

/** Types shared with the form */
export type FormValues = {
  business: {
    businessType: "sole_prop" | "company";
    legalName: string;
    dba?: string;
    ein?: string | undefined;
  };
  contact: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | undefined;
  };
  addresses: {
    billing: z.infer<typeof AddressSchema>;
    services: z.infer<typeof AddressSchema>[];
  };
  plan: typeof PLAN_VALUES[number];
  // team: z.infer<typeof TeamMemberSchema>[];
  agreeToTerms: boolean;
};

export type Step = 0 | 1 | 2 | 3; // 3 = success
export type WizardContext = { step: Step };

/** Reusable shapes by step */
const Step0Schema = z.object({
  business: z.object({
    businessType: z.enum(["sole_prop", "company"]),
    legalName: trimmed.min(1, "Business legal name is required"),
    dba: trimmed.optional(),
    // EIN optional for sole_prop, required for company (9 digits)
    ein: z
      .string()
      .transform((s) => s.replace(/\D/g, ""))
      .refine((s) => s.length === 0 || s.length === 9, {
        message: "EIN must be 9 digits",
      })
      .transform((s) => (s.length === 0 ? undefined : s))
      .optional(),
  }).superRefine((val, ctx) => {
    if (val.businessType === "company" && !val.ein) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ein"],
        message: "EIN is required for companies",
      });
    }
  }),

  contact: z.object({
    firstName: trimmed.min(1, "First name is required"),
    lastName: trimmed.min(1, "Last name is required"),
    email,
    phone,
  }),

  addresses: z.object({
    billing: AddressSchema,
    services: z.array(AddressSchema).default([]),
  }),
});

const Step1Schema = z
  .object({
    addresses: z.object({
      billing: AddressSchema,
      services: z.array(AddressSchema).default([]),
    }),
  })
  .refine(({ addresses }) => (addresses.services?.length ?? 0) > 0, {
    path: ["addresses", "services"],
    message: "Add at least one service address.",
  });

/** Base for step 2 (plan + terms) */
const Step2Base = z.object({
  plan: z.enum(PLAN_VALUES),
  agreeToTerms: z.boolean().refine(Boolean, "You must accept the terms"),
});

/** Add cross-step guard for step 2 */
const makeStep2Schema = (all: FormValues) =>
  Step2Base.superRefine((_, ctx) => {
    const hasServices = (all.addresses?.services?.length ?? 0) > 0;
    if (!hasServices) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agreeToTerms"], // surface on a visible field in step 2
        message: "Add at least one service address before paying.",
      });
    }
  });

/** Step-aware resolver */
export const stepResolver: Resolver<FormValues, WizardContext> = async (
  values,
  ctx,
  opts
) => {
  const step = (ctx?.step ?? 0) as Step;

  if (step === 3) {
    // success screen: no validation
    return { values, errors: {} };
  }

  const schema =
    step === 0
      ? Step0Schema
      : step === 1
      ? Step1Schema
      : makeStep2Schema(values); // step === 2

  const base = zodResolver(schema) as unknown as Resolver<FormValues, WizardContext>;
  const result = await base(values, ctx, opts);
  return { values, errors: result.errors };
};