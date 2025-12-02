// src/lib/server-only.ts
export const serverOnly = () => { if (typeof window !== "undefined") throw new Error("Server-only module"); };
