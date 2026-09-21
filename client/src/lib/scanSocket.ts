import { io, type Socket } from "socket.io-client";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
// socket.io connects to the server root, not the REST "/api" prefix.
const SOCKET_URL = API_BASE.replace(/\/api\/?$/, "");

let socket: Socket | null = null;

// One socket per browser tab, created lazily and left disconnected until a
// caller actually needs it (Billing's "Pair phone" panel, or the phone's
// remote-scan page) — so pages that never touch this feature pay no cost.
export function getScanSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, { autoConnect: false, transports: ["websocket", "polling"] });
  }
  return socket;
}
