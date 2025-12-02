// src/app/api/stripe/create-subscription/company/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeHandlers } from "../_shared";
const { POST, GET } = makeHandlers("business"); // ← important
export { POST, GET };
