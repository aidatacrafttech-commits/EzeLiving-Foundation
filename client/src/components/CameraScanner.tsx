import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface CameraScannerProps {
  onScan: (code: string) => void;
}

const SCANNER_ELEMENT_ID = "camera-scanner-viewport";

export function CameraScanner({ onScan }: CameraScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startScanner() {
    setError(null);
    try {
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.CODE_128,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        {
          facingMode: "environment",
          // A 1D barcode (CODE128/EAN/UPC) needs much finer resolution to
          // decode reliably than a QR code does — most phones default their
          // camera stream to something like 640x480 unless asked for more,
          // which isn't enough detail to resolve the narrow bars on a
          // longer code. Requesting the highest resolution the device will
          // give (it silently falls back to whatever's actually available)
          // is the single biggest lever for reliable 1D decoding here.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        // Wider, shorter box to match a barcode's own aspect ratio (a
        // square box sized for a QR code wastes width a 1D barcode needs
        // and often lets someone crop the ends of a long code out of frame).
        { fps: 10, qrbox: { width: 300, height: 100 } },
        (decodedText) => {
          onScan(decodedText);
        },
        () => {
          // ignore per-frame decode failures, they're expected while aiming
        }
      );
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not access the camera");
      setActive(false);
    }
  }

  async function stopScanner() {
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        await scanner.stop();
        scanner.clear();
      } catch {
        // scanner may already be stopped
      }
      scannerRef.current = null;
    }
    setActive(false);
  }

  return (
    <div className="camera-scanner">
      <div id={SCANNER_ELEMENT_ID} style={{ width: "100%", maxWidth: 360 }} />
      {error && <p className="error-text">{error}</p>}
      {active ? (
        <button type="button" onClick={stopScanner}>
          Stop camera
        </button>
      ) : (
        <button type="button" onClick={startScanner}>
          Start camera scan
        </button>
      )}
    </div>
  );
}
