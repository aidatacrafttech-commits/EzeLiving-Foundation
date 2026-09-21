import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, TriangleAlert, Upload, X } from "lucide-react";
import { api } from "../api/client";
import { parseSpreadsheetFile, type ParsedSheet } from "../utils/bulkImport";
import {
  applyRestockMapping,
  autoMapRestockColumns,
  RESTOCK_FIELD_LABELS,
  RESTOCK_FIELD_ORDER,
  validateAndResolveRestockRows,
  type MappedRestockRow,
  type RestockFieldKey,
  type ResolvedRestockRow,
} from "../utils/purchaseImport";
import type { Product, Warehouse } from "../types";

interface PurchaseImportPanelProps {
  warehouses: Warehouse[];
  onConfirm: (warehouseId: number, rows: ResolvedRestockRow[]) => void;
  onClose: () => void;
}

type Step = "upload" | "mapping" | "resolving" | "preview";

export function PurchaseImportPanel({ warehouses, onConfirm, onClose }: PurchaseImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [warehouseId, setWarehouseId] = useState<number | "">(warehouses[0]?.id ?? "");
  const [step, setStep] = useState<Step>("upload");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, RestockFieldKey | "">>({});
  const [resolvedRows, setResolvedRows] = useState<ResolvedRestockRow[]>([]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const result = await parseSpreadsheetFile(file);
      setParsed(result);
      setMapping(autoMapRestockColumns(result.headers));
      setFileName(file.name);
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't parse this file.");
    } finally {
      setParsing(false);
    }
  }

  const mappedFieldsUsed = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping]);
  const codeMapped = mappedFieldsUsed.has("code");
  const quantityMapped = mappedFieldsUsed.has("quantity");
  const costPriceMapped = mappedFieldsUsed.has("costPrice");

  function updateMapping(header: string, field: RestockFieldKey | "") {
    setMapping((prev) => ({ ...prev, [header]: field }));
  }

  async function resolveAndPreview() {
    if (!parsed) return;
    setStep("resolving");
    setError(null);
    try {
      const mapped: MappedRestockRow[] = applyRestockMapping(parsed.rows, mapping);
      const codes = [...new Set(mapped.map((r) => r.code.trim()).filter(Boolean))];
      const resolvedMap = new Map<string, Product | null>();
      if (codes.length > 0) {
        const res = await api.post<{ results: { code: string; product: Product | null }[] }>(
          "/products/resolve-codes",
          { codes }
        );
        for (const r of res.data.results) resolvedMap.set(r.code, r.product);
      }
      setResolvedRows(validateAndResolveRestockRows(mapped, resolvedMap));
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't match these codes against your products.");
      setStep("mapping");
    }
  }

  const invalidCount = resolvedRows.filter((r) => r.errors.length > 0).length;

  return (
    <div className="admin-form bulk-import-panel">
      <div className="section-header">
        <h3>
          <FileSpreadsheet size={16} /> Restock from Excel/CSV
        </h3>
        <button type="button" className="link-button" onClick={onClose}>
          <X size={14} /> Close
        </button>
      </div>

      <label>
        Restock into warehouse
        <select value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <p className="help-text" style={{ marginTop: 4 }}>
        Every row in the file adds its quantity to this one warehouse. Only <strong>existing</strong> products are
        matched by Barcode or SKU — a code that isn't found is flagged, never auto-created as a new product.
      </p>

      {step === "upload" && (
        <>
          <button type="button" disabled={parsing} onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> {parsing ? "Reading file..." : "Choose file"}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={handleFile} />
          {error && (
            <p className="error-text">
              <TriangleAlert size={14} /> {error}
            </p>
          )}
        </>
      )}

      {step === "mapping" && parsed && (
        <>
          <p className="help-text">
            <strong>{fileName}</strong> — {parsed.rows.length} row(s) found. Columns we recognized are mapped
            automatically; check any marked "Select field" and pick the right one yourself.
          </p>
          <table className="cart-table">
            <thead>
              <tr>
                <th>Column in file</th>
                <th>Sample value</th>
                <th>Maps to</th>
              </tr>
            </thead>
            <tbody>
              {parsed.headers.map((header) => (
                <tr key={header}>
                  <td>{header}</td>
                  <td className="muted small">{parsed.rows[0]?.[header] || "—"}</td>
                  <td>
                    <select value={mapping[header] ?? ""} onChange={(e) => updateMapping(header, e.target.value as RestockFieldKey | "")}>
                      <option value="">— Select field —</option>
                      {RESTOCK_FIELD_ORDER.map((field) => (
                        <option key={field} value={field} disabled={mappedFieldsUsed.has(field) && mapping[header] !== field}>
                          {RESTOCK_FIELD_LABELS[field]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(!codeMapped || !quantityMapped || !costPriceMapped) && (
            <p className="error-text">
              <TriangleAlert size={14} /> Map a column to Barcode/SKU, Quantity received, and Selling price to continue.
            </p>
          )}
          {error && (
            <p className="error-text">
              <TriangleAlert size={14} /> {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={!codeMapped || !quantityMapped || !costPriceMapped || !warehouseId}
              onClick={resolveAndPreview}
            >
              Continue to preview
            </button>
            <button type="button" className="link-button" onClick={() => setStep("upload")}>
              Back
            </button>
          </div>
        </>
      )}

      {step === "resolving" && <p className="help-text">Matching codes against your products...</p>}

      {step === "preview" && (
        <>
          <p className={invalidCount > 0 ? "error-text" : "success-text"}>
            {invalidCount > 0 ? <TriangleAlert size={14} /> : <CheckCircle2 size={14} />}
            {resolvedRows.length} row(s) — {resolvedRows.length - invalidCount} ready, {invalidCount} need correction
            (fix the file and re-upload).
          </p>
          <div className="bulk-table-wrap">
            <table className="cart-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Matched product</th>
                  <th>Quantity</th>
                  <th>Damaged</th>
                  <th>Selling price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {resolvedRows.map((row, i) => (
                  <tr key={i} className={row.errors.length > 0 ? "bulk-row-error" : ""}>
                    <td>{row.code || "—"}</td>
                    <td>{row.product?.name || "—"}</td>
                    <td>{row.quantity || "—"}</td>
                    <td>{row.damagedQty || "0"}</td>
                    <td>{row.costPrice || "—"}</td>
                    <td>
                      {row.errors.length === 0 ? (
                        <span className="discount-badge">ok</span>
                      ) : (
                        <span className="out-of-stock-badge" title={row.errors.join(", ")}>
                          {row.errors.length} issue(s)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={resolvedRows.length - invalidCount === 0}
              onClick={() => warehouseId && onConfirm(warehouseId, resolvedRows.filter((r) => r.errors.length === 0))}
            >
              <CheckCircle2 size={14} /> Add {resolvedRows.length - invalidCount} row(s) to this purchase
            </button>
            <button type="button" className="link-button" onClick={() => setStep("mapping")}>
              Back to mapping
            </button>
          </div>
        </>
      )}
    </div>
  );
}
