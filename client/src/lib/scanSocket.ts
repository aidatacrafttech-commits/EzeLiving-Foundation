import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Phone-as-wireless-scanner pairing, relayed through a Supabase Realtime
// broadcast channel — no server of our own required. Lovable Cloud only
// hosts serverless functions (no always-on process), so a self-run
// WebSocket server (this used to be socket.io) can't be deployed here;
// Supabase's Realtime service holds the persistent connection on its own
// infrastructure instead, and both devices just subscribe to a channel
// named after the pairing session id.
const SCAN_EVENT = "scan-barcode";

function channelName(sessionId: string): string {
  return `scan-session-${sessionId}`;
}

// One channel per active pairing session, created lazily and torn down via
// the returned cleanup — same "pay no cost until used" shape the socket.io
// version had.
export function openScanChannel(sessionId: string): RealtimeChannel {
  return supabase.channel(channelName(sessionId));
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

export function closeScanChannel(channel: RealtimeChannel) {
  supabase.removeChannel(channel);
}
