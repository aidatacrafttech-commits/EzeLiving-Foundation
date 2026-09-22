import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "../config/env";

const localhostPattern = /^http:\/\/localhost:\d+$/;

// Lets a phone act as a wireless barcode scanner for an open Billing page:
// the laptop opens a random session id (shown to the cashier as a QR code),
// the phone joins the same id after scanning it, and every barcode the
// phone's camera reads gets relayed straight into the laptop's existing
// scan-and-lookup flow. The session id itself is the only credential — it's
// a long random UUID that's never guessable and only ever shown inside an
// already-logged-in Billing session, so the phone page needs no separate
// login.
export function attachScanPairing(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin(origin, callback) {
        if (
          !origin ||
          env.corsOrigins.includes(origin) ||
          (env.appEnv === "development" && localhostPattern.test(origin))
        ) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
    },
  });

  io.on("connection", (socket) => {
    socket.on("join-scan-session", (sessionId: unknown) => {
      if (typeof sessionId === "string" && sessionId.length > 0 && sessionId.length < 200) {
        socket.join(sessionId);
      }
    });

    socket.on("scan-barcode", (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const { sessionId, barcode } = payload as Record<string, unknown>;
      if (typeof sessionId === "string" && typeof barcode === "string") {
        // Relay to the rest of the room (the paired laptop) only — the phone
        // that sent it doesn't need it echoed back.
        socket.to(sessionId).emit("scan-barcode", barcode);
      }
    });
  });

  return io;
}
