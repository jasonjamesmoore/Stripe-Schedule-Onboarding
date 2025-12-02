// src/features/payments/stripe/server/prices.ts
import { serverOnly } from "@/lib/validation/server-only";
import type { Plan } from "@/features/payments/stripe/shared/plan";

serverOnly();

export type AccountType = "individual" | "business";

export const PRICE_BY_PLAN: Record<AccountType, Record<Plan, string>> = {
  individual: {
    trash: "price_1SEEJ902heDK9w4zW4O0taqq",
    seasonal_2nd: "price_1SEEJv02heDK9w4zus2PQtCK"
  },
  business: {
   trash: "price_1SEEKZ02heDK9w4zWLUKNrPi",
    seasonal_2nd: "price_1SEELH02heDK9w4zU4HxRJuY"
  }
} as const;


// //-------------------------
// //Test Prices
// //-------------------------
// export const PRICE_BY_PLAN: Record<AccountType, Record<Plan, string>> = {
//   individual: {
//     trash: "price_1S184RIr0MMYHEqPhw5fJ8IG",
//     seasonal_2nd: "price_1S3JWNIr0MMYHEqPjtUJqjdn"
//   },
//   business: {
//    trash: "price_1SFH2VIr0MMYHEqPCpKeXFay",
//     seasonal_2nd: "price_1SFH2vIr0MMYHEqPQVv2YG9e"
//   }
// } as const;