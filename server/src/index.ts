import http from "http";
import { app } from "./app";
import { env } from "./config/env";
import { sweepExpiredHolds } from "./services/holdExpiry";
import { attachScanPairing } from "./realtime/scanPairing";

// http.createServer(app) is exactly what app.listen() does under the hood —
// pulled out explicitly here so socket.io (remote phone-scanner pairing) can
// share the same HTTP server/port instead of needing one of its own.
const httpServer = http.createServer(app);
attachScanPairing(httpServer);

httpServer.listen(env.port, () => {
  console.log(`API server listening on http://localhost:${env.port}`);
});

// Hold invoices also self-heal on every list/get/process call, so this
// interval just keeps their status current even when nobody is actively
// looking at the Hold section.
sweepExpiredHolds().catch((err) => console.error("Initial hold-expiry sweep failed:", err));
setInterval(() => {
  sweepExpiredHolds().catch((err) => console.error("Hold-expiry sweep failed:", err));
}, 15 * 60 * 1000);
