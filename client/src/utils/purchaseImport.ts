import type { Product } from "../types";

// Column mapping for the Purchases "Import from Excel/CSV" restock flow —
// deliberately separate from bulkImport.ts's field set, since restocking an
// existing product needs a code + quantity/cost, not a full product record.
export type RestockFieldKey = "code" | "quantity" | "costPrice" | "damagedQty";

export const RESTOCK_FIELD_LABELS: Record<RestockFieldKey, string> = {
  code: "Barcode / SKU",
  quantity: "Quantity received",
  costPrice: "Selling price",
  damagedQty: "Damaged (transit)",
};

export const RESTOCK_FIELD_ORDER: RestockFieldKey[] = ["code", "quantity", "costPrice", "damagedQty"];

const RESTOCK_COLUMN_ALIASES: Record<RestockFieldKey, string[]> = {
  code: ["barcode", "sku", "code", "itemcode", "productcode", "ean", "upc"],
  quantity: ["quantity", "qty", "stock", "totalqty", "totalstock", "receivedqty", "goodqty"],
  costPrice: ["costprice", "cost", "rate", "purchaseprice", "purchaserate"],
  damagedQty: ["damagedqty", "damaged", "damage", "transitdamage", "damagedtransit"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-effort auto-mapping — "" means "couldn't confidently identify this column". */
export function autoMapRestockColumns(headers: string[]): Record<string, RestockFieldKey | ""> {
  const mapping: Record<string, RestockFieldKey | ""> = {};
  const used = new Set<RestockFieldKey>();

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    let match: RestockFieldKey | "" = "";
    for (const field of RESTOCK_FIELD_ORDER) {
      if (used.has(field)) continue;
      if (RESTOCK_COLUMN_ALIASES[field].includes(normalized)) {
        match = field;
        break;
      }
    }
    mapping[header] = match;
    if (match) used.add(match);
  }
  return mapping;
}

export interface MappedRestockRow {
  code: string;
  quantity: string;
  costPrice: string;
  damagedQty: string;
}

/** Applies the confirmed header->field mapping to every raw row. */
export function applyRestockMapping(
  rows: Record<string, string>[],
  mapping: Record<string, RestockFieldKey | "">
): MappedRestockRow[] {
  return rows.map((row) => {
    const mapped: MappedRestockRow = { code: "", quantity: "", costPrice: "", damagedQty: "" };
    for (const [header, field] of Object.entries(mapping)) {
      if (field) mapped[field] = row[header] ?? "";
    }
    return mapped;
  });
}

export interface ResolvedRestockRow extends MappedRestockRow {
  product: Product | null;
  errors: string[];
}

/**
 * Validates each mapped row's numbers and resolves its code against the
 * `code -> matched product` map fetched from /products/resolve-codes — a row
 * whose code doesn't match any existing product is flagged, never silently
 * turned into a new product (this flow only ever restocks what exists).
 */
export function validateAndResolveRestockRows(
  rows: MappedRestockRow[],
  resolvedProducts: Map<string, Product | null>
): ResolvedRestockRow[] {
  const seenCodes = new Set<string>();

  return rows.map((row) => {
    const errors: string[] = [];
    const code = row.code.trim();

    if (!code) errors.push("Barcode/SKU is required");
    if (row.quantity.trim() === "" || Number.isNaN(Number(row.quantity)) || Number(row.quantity) <= 0) {
      errors.push("Quantity must be a positive number");
    }
    if (row.costPrice.trim() === "" || Number.isNaN(Number(row.costPrice)) || Number(row.costPrice) < 0) {
      errors.push("Selling price must be a non-negative number");
    }
    if (row.damagedQty.trim() !== "" && (Number.isNaN(Number(row.damagedQty)) || Number(row.damagedQty) < 0)) {
      errors.push("Damaged qty must be a non-negative number");
    }

    let product: Product | null = null;
    if (code) {
      if (seenCodes.has(code)) {
        errors.push("Duplicate code within this file");
      }
      seenCodes.add(code);

      const match = resolvedProducts.get(code);
      if (match === undefined) {
        errors.push("Not resolved yet");
      } else if (match === null) {
        errors.push("No matching product found for this code");
      } else {
        product = match;
      }
    }

    return { ...row, product, errors };
  });
}
