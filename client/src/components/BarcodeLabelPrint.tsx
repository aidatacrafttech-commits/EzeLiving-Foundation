import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export interface BarcodeLabelEntry {
  code: string;
  name?: string;
  mrp?: number;
  copies: number;
}

interface BarcodeLabelPrintProps {
  entries: BarcodeLabelEntry[];
  onDone: () => void;
  /** Physical label size in millimeters. Defaults to the original 50x30mm. */
  widthMm?: number;
  heightMm?: number;
}

function buildLabelStyles(widthMm: number, heightMm: number): string {
  return `
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
  .barcode-label {
    position: relative;
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    padding: 2mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    page-break-after: always;
    break-after: page;
  }
  .barcode-label:last-child { page-break-after: auto; break-after: auto; }
  .barcode-label-brand {
    position: absolute;
    top: 1mm;
    right: 1.5mm;
    font-size: 6.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #7a1027;
  }
  .barcode-label-name {
    margin: 0 0 2px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9px;
    font-weight: 700;
    color: #000;
  }
  .barcode-label-price { margin: 2px 0 0; font-size: 10px; font-weight: 700; color: #000; }
  svg { display: block; }
`;
}

// JsBarcode's `width` option is the narrow-bar module width in SVG user
// units (~px) — too thin and cheap printers/scanners can't resolve it,
// too thick and it won't fit a small label. Scaling both it and the bar
// height with the chosen label size (relative to the original 50x30mm
// default) keeps the barcode proportioned to whatever size is picked,
// clamped to a range that stays printable and scannable at either end.
function barcodeDimensions(widthMm: number, heightMm: number) {
  const barWidth = Math.max(1.2, Math.min(2.5, 1.6 * (widthMm / 50)));
  const barHeight = Math.max(20, Math.min(60, 40 * (heightMm / 30)));
  return { barWidth, barHeight };
}

// Renders `copies` labels per entry into an off-screen staging area — just
// far enough off-canvas to stay out of view, but still genuinely laid out
// (not display:none / visibility:hidden), because JsBarcode measures text
// width via the DOM and gets back 0 for anything inside a non-laid-out
// ancestor, which silently produced blank barcodes.
//
// The rendered labels' HTML is then copied into a brand-new, completely
// isolated print window — not printed in place. Printing in place (even
// with a "hide everything else" CSS rule) still leaves the rest of this
// page's real content sitting in the document's layout flow, and Chrome
// paginates print output by height: a tall admin page hidden this way
// still spanned dozens of near-blank 30mm-tall "pages", which a thermal
// label printer just fed through one after another. An isolated window
// has nothing in it but the labels, so it can only ever produce exactly as
// many physical labels as there are entries.
export function BarcodeLabelPrint({ entries, onDone, widthMm = 50, heightMm = 30 }: BarcodeLabelPrintProps) {
  const stagingRef = useRef<HTMLDivElement>(null);
  const { barWidth, barHeight } = barcodeDimensions(widthMm, heightMm);

  useEffect(() => {
    if (entries.length === 0) return;

    // No setTimeout here on purpose: JsBarcode already ran (synchronously,
    // in the <svg> ref callbacks below) during React's commit, which
    // happens before this effect fires — the labels are already fully
    // rendered by the time we get here. Popping the window open right away,
    // as close to the triggering click as this state-driven flow allows,
    // also gives browser popup-blockers the best chance of allowing it.
    const staging = stagingRef.current;
    if (!staging) {
      onDone();
      return;
    }

    const printWindow = window.open("", "_blank", "width=420,height=600");
    if (!printWindow) {
      window.alert("Popup blocked — please allow popups for this site, then try printing again.");
      onDone();
      return;
    }

    printWindow.document.open();
    printWindow.document.write(
      `<!doctype html><html><head><title>Barcode labels</title><style>${buildLabelStyles(widthMm, heightMm)}</style></head><body>${staging.innerHTML}</body></html>`
    );
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.onafterprint = () => {
      printWindow.close();
      onDone();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  if (entries.length === 0) return null;

  // Flatten { code, copies } entries into one item per physical label so
  // each gets its own React key and its own <svg> render.
  const labels = entries.flatMap((entry, entryIndex) =>
    Array.from({ length: Math.max(1, entry.copies) }, (_, i) => ({ ...entry, key: `${entryIndex}-${entry.code}-${i}` }))
  );

  return (
    <div ref={stagingRef} style={{ position: "fixed", top: 0, left: "-9999px" }} aria-hidden="true">
      {labels.map(({ code, name, mrp, key }) => (
        <div className="barcode-label" key={key}>
          <span className="barcode-label-brand">Eze Living</span>
          {name && <p className="barcode-label-name">{name}</p>}
          <svg
            ref={(el) => {
              if (!el) return;
              JsBarcode(el, code, {
                format: "CODE128",
                width: barWidth,
                height: barHeight,
                fontSize: 12,
                margin: 0,
                displayValue: true,
              });
            }}
          />
          {mrp !== undefined && <p className="barcode-label-price">MRP ₹{mrp.toFixed(2)}</p>}
        </div>
      ))}
    </div>
  );
}
