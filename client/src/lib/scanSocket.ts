import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { api } from "../api/client";

// Phone-as-wireless-scanner pairing, relayed through a Supabase Realtime
// broadcast channel — no server of our own required. Lovable Cloud only
// hosts serverless functions (no always-on process), so a self-run
// WebSocket server (this used to be socket.io) can't be deployed here;
// Supabase's Realtime service holds the persistent connection on its own
// infrastructure instead, and both devices just subscribe to a channel
// named after the pairing session id.
//
// This deliberately does NOT reuse the Lovable-generated
// "@/integrations/supabase/client" — that one reads its URL/key from
// Vite's build-time `import.meta.env.VITE_*` injection, which was never
// populated for this project (see config.server.ts). Instead, this fetches
// the same values our server already uses successfully, once, from our own
// API, and builds a small Realtime-only client from them at runtime.
const SCAN_EVENT = "scan-barcode";

let clientPromise: Promise<SupabaseClient> | null = null;

function getClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = api
      .get<{ supabaseUrl: string; supabasePublishableKey: string }>("/public-config")
      .then((res) => createClient(res.data.supabaseUrl, res.data.supabasePublishableKey));
  }
  return clientPromise;
}

function channelName(sessionId: string): string {
  return `scan-session-${sessionId}`;
}

// One channel per active pairing session, created lazily and torn down via
// closeScanChannel — same "pay no cost until used" shape the socket.io
// version had. Resolves once the (cached, one-time-fetched) Supabase client
// is ready.
export async function openScanChannel(sessionId: string): Promise<RealtimeChannel> {
  const client = await getClient();
  return client.channel(channelName(sessionId));
}

export function sendScan(channel: RealtimeChannel, barcode: string) {
  channel.send({ type: "broadcast", event: SCAN_EVENT, payload: { barcode } });
}

export function onScan(channel: RealtimeChannel, handler: (barcode: string) => void): RealtimeChannel {
  return channel.on("broadcast", { event: SCAN_EVENT }, ({ payload }) => {
    if (payload && typeof (payload as { barcode?: unknown }).barcode === "string") {
      handler((payload as { barcode: string }).barcode);
    }
  });
}

export async function closeScanChannel(channel: RealtimeChannel) {
  const client = await getClient();
  client.removeChannel(channel);
}
