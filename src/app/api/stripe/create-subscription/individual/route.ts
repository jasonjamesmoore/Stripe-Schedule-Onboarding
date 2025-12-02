// src/app/api/stripe/create-subscription/individual/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { makeHandlers } from "../_shared";
const { POST, GET } = makeHandlers("individual");
export { POST, GET };
