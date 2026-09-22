import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, ScanLine } from "lucide-react";
import { CameraScanner } from "../components/CameraScanner";
import { getScanSocket } from "../lib/scanSocket";

// Opened on the phone by scanning the QR code from Billing's "Pair phone"
// panel. No login here — the session id in the URL is the only credential,
// and it only ever exists because an already-logged-in cashier generated it.
export function RemoteScan() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [lastSent, setLastSent] = useState<string | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const socket = getScanSocket();
    socket.connect();
    socket.emit("join-scan-session", sessionId);
    return () => {
      socket.disconnect();
    };
  }, [sessionId]);

  function handleScan(barcode: string) {
    if (!sessionId) return;
    // The camera re-reads a held-up barcode on every frame — collapse
    // repeats of the same code within a couple of seconds into one send so
    // a single scan doesn't hit the laptop's lookup over and over.
    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.code === barcode && now - lastScanRef.current.at < 2000) {
      return;
    }
    lastScanRef.current = { code: barcode, at: now };
    getScanSocket().emit("scan-barcode", { sessionId, barcode });
    setLastSent(barcode);
  }

  if (!sessionId) return null;

  return (
    <div className="remote-scan-page">
      <h2>
        <ScanLine size={19} /> Remote Barcode Scanner
      </h2>
      <p className="help-text">Point the camera at a barcode — it'll show up on the billing screen instantly.</p>
      <CameraScanner onScan={handleScan} />
      {lastSent && (
        <p className="success-text">
          <CheckCircle2 size={14} /> Sent: {lastSent}
        </p>
      )}
    </div>
  );
}
