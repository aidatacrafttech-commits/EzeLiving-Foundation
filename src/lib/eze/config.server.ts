import { ApiError, type Ctx, type RouteDef } from "./core.server";

// Hands the browser the two Supabase values it needs to open its own
// Realtime connection (phone-scanner pairing) — read at request time from
// the server's own runtime environment, the same SUPABASE_URL/
// SUPABASE_PUBLISHABLE_KEY that auth-middleware.ts already uses for every
// authenticated request. Both are meant to be public: the "publishable"
// key is Supabase's client-safe key by design (not the service-role key,
// which only ever lives in client.server.ts and never leaves the server).
//
// This exists because Vite's build-time `import.meta.env.VITE_*`
// injection — what the Lovable-generated browser client normally relies
// on — was never populated for this project's build step, even though
// the equivalent runtime env vars are set and already working
// server-side. Fetching them at request time sidesteps that gap entirely
// without needing any Lovable Cloud configuration change.
async function getPublicConfig(_ctx: Ctx) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new ApiError(500, "Supabase is not configured on the server");
  }
  return { supabaseUrl: url, supabasePublishableKey: key };
}

export const configRoutes: RouteDef[] = [{ method: "GET", path: "public-config", handler: getPublicConfig }];
