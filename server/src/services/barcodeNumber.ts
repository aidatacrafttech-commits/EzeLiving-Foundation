import type { Prisma } from "@prisma/client";
import { getNextDocumentNumber } from "./documentNumber";

export type BarcodeMaterial = "MB" | "GL" | "OT";

/**
 * Generates the next sequential "our own" barcode number, e.g.
 * EZE-2026-00001, or MB-EZE-2026-00001 when a material is given. Same
 * race-safe counter as invoice/purchase numbers (shared across materials —
 * the material only changes the prefix, not the sequence), so this never
 * collides with those sequences, and its own prefix makes a self-minted
 * code instantly distinguishable from a scanned-in manufacturer barcode
 * (which never looks like this). Must be called inside the same
 * transaction that inserts the GeneratedBarcode row.
 */
export async function generateBarcodeNumber(
  tx: Prisma.TransactionClient,
  material?: BarcodeMaterial
): Promise<string> {
  const prefix = material ? `${material}-EZE-` : "EZE-";
  return getNextDocumentNumber(tx, "BARCODE", prefix);
}
