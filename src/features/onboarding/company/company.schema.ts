import { z } from "zod";
import { PLAN_VALUES } from "@/features/payments/stripe/shared/plan";

export const trimmed = z.string().trim();

export const email = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.email());

export const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, "")) // digits only
  .refine((d) => d.length === 0 || (d.length >= 10 && d.length <= 15), {
    message: "Phone must be 10–15 digits",
  })
  .transform((d) => (d.length === 0 ? undefined : d))
  .optional();

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const stateCode = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => s.length === 2 && US_STATES.has(s), "Use a valid 2-letter state code");

const postalUS = z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Invalid ZIP code");

export const AddressSchema = z.object({
  line1: trimmed.min(1, "Address is required"),
  line2: trimmed.optional(),
  city: trimmed.min(1, "City is required"),
  state: stateCode,
  postalCode: postalUS,
  country: trimmed.default("US"),
});

export const TeamMemberSchema = z.object({
  name: trimmed.min(1),
  email,
  role: trimmed.optional(),
});

export const OnboardingSchema = z
  .object({
    business: z.object({
      businessType: z.enum(["sole_prop", "company"]),
      legalName: trimmed.min(1, "Business legal name is required"),
      dba: trimmed.optional(),
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

    addresses: z
      .object({
        billing: AddressSchema,
        services: z.array(AddressSchema).default([]),
      })
      .refine(({ services }) => (services?.length ?? 0) > 0, {
        path: ["services"],
        message: "Add at least one service address.",
      }),

    plan: z.enum(PLAN_VALUES),

    // Optional, harmless
    team: z.array(TeamMemberSchema).default([]),

    agreeToTerms: z.boolean().refine(Boolean, {
      message: "You must accept the terms",
    }),
  });