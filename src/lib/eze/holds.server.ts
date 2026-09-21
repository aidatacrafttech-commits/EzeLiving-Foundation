// Hold Invoice routes ported from the original Express/Prisma backend
// (server/src/controllers/holdInvoices.controller.ts, server/src/services/holdExpiry.ts,
// server/src/services/holdInvoiceNumber.ts).
import { z } from "zod";

import {
  ApiError,
  db,
  nextDocumentNumber,
  recordAudit,
  requireUser,
  toCamel,
  unwrap,
  type Ctx,
  type RouteDef,
} from "./core.server";

const HOLD_VALIDITY_DAYS = 3;
const HOLD_STATUSES = ["active", "completed", "returned", "expired"] as const;

const HOLD_INCLUDE =
  "*, items:hold_invoice_items(*, product:products(*)), customer:customers(*), warehouse:warehouses(*), final_invoice:invoices!invoices_hold_invoice_id_fkey(*)";

function generateHoldNumber(): Promise<string> {
  return nextDocumentNumber("HOLD", "HOLD-");
}

function generateInvoiceNumber(): Promise<string> {
  return nextDocumentNumber("INVOICE", "INV-");
}

/* ------------------------------------------------------------------ */
/* Expiry sweep — mirrors holdExpiry.ts, run inline before list/get/process */
/* ------------------------------------------------------------------ */

async function sweepExpiredHolds(): Promise<number> {
  const { data: expired } = await db
    .from("hold_invoices")
    .select("id")
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString());

  let convertedCount = 0;
  for (const row of expired ?? []) {
    const converted = await convertExpiredHold(row.id);
    if (converted) convertedCount++;
  }
  return convertedCount;
}

async function convertExpiredHold(holdInvoiceId: number): Promise<boolean> {
  try {
    const { data: hold } = await db.from("hold_invoices").select("*").eq("id", holdInvoiceId).maybeSingle();
    if (!hold || hold.status !== "active" || new Date(hold.expires_at) >= new Date()) return false;

    const { data: items } = await db.from("hold_invoice_items").select("*").eq("hold_invoice_id", hold.id);
    const holdItems = items ?? [];

    let subtotal = 0;
    let taxAmount = 0;
    const itemsData = holdItems.map((item: any) => {
      const price = Number(item.price);
      const lineBase = price * item.qty;
      const lineTax = (lineBase * Number(item.tax_percent)) / 100;
      const lineTotal = lineBase + lineTax;
      subtotal += lineBase;
      taxAmount += lineTax;
      return {
        product_id: item.product_id,
        qty: item.qty,
        mrp: item.mrp,
        price: item.price,
        tax_amount: lineTax,
        line_total: lineTotal,
      };
    });
    const grandTotal = subtotal + taxAmount;

    const invoiceNumber = await generateInvoiceNumber();
    const invoiceRes = await db
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        customer_id: hold.customer_id,
        warehouse_id: hold.warehouse_id,
        subtotal,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        payment_mode: "cash",
        status: "paid",
        created_by_id: hold.created_by_id,
        hold_invoice_id: hold.id,
      } as any)
      .select("id, invoice_number")
      .single();
    const invoice = unwrap(invoiceRes);

    if (itemsData.length > 0) {
      await db.from("invoice_items").insert(itemsData.map((i) => ({ ...i, invoice_id: invoice.id })) as any);
    }

    for (const item of holdItems) {
      await db.from("hold_invoice_items").update({ kept_qty: item.qty } as any).eq("id", item.id);
    }

    await db
      .from("hold_invoices")
      .update({ status: "expired", processed_at: new Date().toISOString() } as any)
      .eq("id", hold.id);

    if (hold.created_by_id) {
      await recordAudit({
        userId: hold.created_by_id,
        action: "HOLD_EXPIRED",
        entityType: "HoldInvoice",
        entityId: hold.id,
        metadata: {
          holdNumber: hold.hold_number,
          invoiceNumber: invoice.invoice_number,
          itemCount: holdItems.length,
        },
      });
    }
    return true;
  } catch (err) {
    console.error(`Failed to auto-expire hold invoice ${holdInvoiceId}:`, err);
    return false;
  }
}

async function fetchHold(id: number) {
  const { data: hold } = await db.from("hold_invoices").select(HOLD_INCLUDE).eq("id", id).maybeSingle();
  return hold;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

const createHoldSchema = z.object({
  warehouseId: z.number().int(),
  customerId: z.number().int().optional(),
  items: z
    .array(z.object({ productId: z.number().int(), qty: z.number().int().positive() }))
    .min(1, "Select at least one item to hold"),
});

async function createHoldInvoice(ctx: Ctx) {
  const actor = requireUser(ctx);
  const data = createHoldSchema.parse(ctx.body);

  const productIds = data.items.map((i) => i.productId);
  const productsRes = await db.from("products").select("*").in("id", productIds);
  const products = unwrap(productsRes);
  const productMap = new Map(products.map((p: any) => [p.id, p]));

  for (const item of data.items) {
    if (!productMap.has(item.productId)) {
      throw new ApiError(400, `Product ${item.productId} not found`);
    }
  }

  const stockRes = await db
    .from("stock")
    .select("*")
    .eq("warehouse_id", data.warehouseId)
    .in("product_id", productIds);
  const stockRows = unwrap(stockRes);
  const stockMap = new Map(stockRows.map((s: any) => [s.product_id, s]));

  for (const item of data.items) {
    const stock = stockMap.get(item.productId);
    if (!stock || stock.quantity < item.qty) {
      const product = productMap.get(item.productId)!;
      throw new ApiError(
        400,
        `Insufficient stock for "${product.name}" at the selected warehouse (available: ${stock?.quantity ?? 0}, requested: ${item.qty})`
      );
    }
  }

  const holdNumber = await generateHoldNumber();
  const expiresAt = new Date(Date.now() + HOLD_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  const createdRes = await db
    .from("hold_invoices")
    .insert({
      hold_number: holdNumber,
      customer_id: data.customerId ?? null,
      warehouse_id: data.warehouseId,
      expires_at: expiresAt.toISOString(),
      created_by_id: actor.id,
    } as any)
    .select("*")
    .single();
  const created = unwrap(createdRes);

  const itemsData = data.items.map((item) => {
    const product = productMap.get(item.productId)!;
    return {
      hold_invoice_id: created.id,
      product_id: item.productId,
      qty: item.qty,
      mrp: product.mrp,
      price: product.selling_price,
      tax_percent: product.tax_percent,
    };
  });
  await db.from("hold_invoice_items").insert(itemsData as any);

  for (const item of data.items) {
    const stock = stockMap.get(item.productId)!;
    const product = productMap.get(item.productId)!;

    const { data: decremented, error } = await db
      .from("stock")
      .update({ quantity: stock.quantity - item.qty } as any)
      .eq("id", stock.id)
      .gte("quantity", item.qty)
      .select("id")
      .maybeSingle();
    if (error) throw new ApiError(400, error.message);
    if (!decremented) {
      throw new ApiError(400, `Insufficient stock for "${product.name}" — someone else may have just sold it`);
    }

    const { data: updatedStock } = await db.from("stock").select("quantity").eq("id", stock.id).single();
    const previousQty = updatedStock!.quantity + item.qty;

    await db.from("stock_ledger").insert({
      product_id: item.productId,
      warehouse_id: data.warehouseId,
      change_qty: -item.qty,
      previous_qty: previousQty,
      balance_qty: updatedStock!.quantity,
      reference_type: "hold",
      reference_id: created.id,
      performed_by_id: actor.id,
      reason: `Held on ${created.hold_number}`,
    } as any);
  }

  await recordAudit({
    userId: actor.id,
    action: "HOLD_CREATED",
    entityType: "HoldInvoice",
    entityId: created.id,
    metadata: { holdNumber: created.hold_number, warehouseId: data.warehouseId, itemCount: data.items.length },
  });

  const hold = await fetchHold(created.id);
  return toCamel(hold);
}

/* ------------------------------------------------------------------ */
/* List / Get                                                          */
/* ------------------------------------------------------------------ */

async function listHoldInvoices(ctx: Ctx) {
  requireUser(ctx);
  await sweepExpiredHolds();

  const statusParam = ctx.query.get("status");
  const status =
    statusParam && (HOLD_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof HOLD_STATUSES)[number])
      : undefined;

  let query = db.from("hold_invoices").select(HOLD_INCLUDE).order("created_at", { ascending: false }).limit(200);
  if (status) query = query.eq("status", status);

  const res = await query;
  return toCamel(unwrap(res));
}

async function getHoldInvoice(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params.id);
  await sweepExpiredHolds();

  const hold = await fetchHold(id);
  if (!hold) throw new ApiError(404, "Hold invoice not found");
  return toCamel(hold);
}

/* ------------------------------------------------------------------ */
/* Process                                                             */
/* ------------------------------------------------------------------ */

const processHoldSchema = z.object({
  items: z
    .array(
      z.object({
        holdInvoiceItemId: z.number().int(),
        keepQty: z.number().int().nonnegative(),
        returnNormalQty: z.number().int().nonnegative(),
        returnDamagedQty: z.number().int().nonnegative(),
      })
    )
    .min(1, "Decide on at least one item"),
});

async function processHoldInvoice(ctx: Ctx) {
  const actor = requireUser(ctx);
  const id = Number(ctx.params.id);
  const data = processHoldSchema.parse(ctx.body);

  await sweepExpiredHolds();

  const { data: hold } = await db.from("hold_invoices").select("*").eq("id", id).maybeSingle();
  if (!hold) throw new ApiError(404, "Hold invoice not found");
  if (hold.status !== "active") {
    throw new ApiError(400, `Hold invoice is already ${hold.status} — it cannot be processed again`);
  }

  const { data: holdItemRows } = await db.from("hold_invoice_items").select("*").eq("hold_invoice_id", hold.id);
  const holdItems = holdItemRows ?? [];
  const itemMap = new Map(holdItems.map((i: any) => [i.id, i]));

  for (const line of data.items) {
    if (!itemMap.has(line.holdInvoiceItemId)) {
      throw new ApiError(400, `Item ${line.holdInvoiceItemId} does not belong to this hold invoice`);
    }
  }
  if (data.items.length !== holdItems.length) {
    throw new ApiError(400, "Every held item must be decided (kept/returned) in this request");
  }
  for (const line of data.items) {
    const item = itemMap.get(line.holdInvoiceItemId)!;
    const accounted = line.keepQty + line.returnNormalQty + line.returnDamagedQty;
    if (accounted !== item.qty) {
      throw new ApiError(
        400,
        `Item ${item.id}: keep + returned (normal + damaged) must add up to the held quantity (${item.qty}), got ${accounted}`
      );
    }
  }

  let subtotal = 0;
  let taxAmount = 0;
  const keptInvoiceItems: Array<{
    product_id: number;
    qty: number;
    mrp: any;
    price: any;
    tax_amount: number;
    line_total: number;
  }> = [];

  for (const line of data.items) {
    const item = itemMap.get(line.holdInvoiceItemId)!;

    await db
      .from("hold_invoice_items")
      .update({
        kept_qty: line.keepQty,
        returned_normal_qty: line.returnNormalQty,
        returned_damaged_qty: line.returnDamagedQty,
      } as any)
      .eq("id", item.id);

    if (line.keepQty > 0) {
      const price = Number(item.price);
      const lineBase = price * line.keepQty;
      const lineTax = (lineBase * Number(item.tax_percent)) / 100;
      subtotal += lineBase;
      taxAmount += lineTax;
      keptInvoiceItems.push({
        product_id: item.product_id,
        qty: line.keepQty,
        mrp: item.mrp,
        price: item.price,
        tax_amount: lineTax,
        line_total: lineBase + lineTax,
      });
    }

    const returnedQty = line.returnNormalQty + line.returnDamagedQty;
    if (returnedQty > 0) {
      const { data: existingStock } = await db
        .from("stock")
        .select("*")
        .eq("product_id", item.product_id)
        .eq("warehouse_id", hold.warehouse_id)
        .maybeSingle();

      if (existingStock) {
        await db
          .from("stock")
          .update({
            quantity: existingStock.quantity + line.returnNormalQty,
            damaged_quantity: existingStock.damaged_quantity + line.returnDamagedQty,
          } as any)
          .eq("id", existingStock.id);
      } else {
        await db.from("stock").insert({
          product_id: item.product_id,
          warehouse_id: hold.warehouse_id,
          quantity: line.returnNormalQty,
          damaged_quantity: line.returnDamagedQty,
          reorder_level: 0,
        } as any);
      }

      if (line.returnNormalQty > 0) {
        const { data: updatedStock } = await db
          .from("stock")
          .select("quantity")
          .eq("product_id", item.product_id)
          .eq("warehouse_id", hold.warehouse_id)
          .single();
        const previousQty = updatedStock!.quantity - line.returnNormalQty;
        await db.from("stock_ledger").insert({
          product_id: item.product_id,
          warehouse_id: hold.warehouse_id,
          change_qty: line.returnNormalQty,
          previous_qty: previousQty,
          balance_qty: updatedStock!.quantity,
          reference_type: "return",
          reference_id: hold.id,
          performed_by_id: actor.id,
          reason: `Returned from ${hold.hold_number} (normal)`,
        } as any);
      }
    }
  }

  let finalInvoiceNumber: string | null = null;
  if (keptInvoiceItems.length > 0) {
    const grandTotal = subtotal + taxAmount;
    const invoiceNumber = await generateInvoiceNumber();
    const invoiceRes = await db
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        customer_id: hold.customer_id,
        warehouse_id: hold.warehouse_id,
        subtotal,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        payment_mode: "cash",
        status: "paid",
        created_by_id: actor.id,
        hold_invoice_id: hold.id,
      } as any)
      .select("id, invoice_number")
      .single();
    const invoice = unwrap(invoiceRes);
    finalInvoiceNumber = invoice.invoice_number;

    await db
      .from("invoice_items")
      .insert(keptInvoiceItems.map((i) => ({ ...i, invoice_id: invoice.id })) as any);
  }

  const newStatus = keptInvoiceItems.length > 0 ? "completed" : "returned";
  await db
    .from("hold_invoices")
    .update({ status: newStatus, processed_at: new Date().toISOString() } as any)
    .eq("id", hold.id);

  await recordAudit({
    userId: actor.id,
    action: newStatus === "completed" ? "HOLD_COMPLETED" : "HOLD_RETURNED",
    entityType: "HoldInvoice",
    entityId: hold.id,
    metadata: {
      holdNumber: hold.hold_number,
      invoiceNumber: finalInvoiceNumber,
      keptItemCount: keptInvoiceItems.length,
    },
  });

  const result = await fetchHold(hold.id);
  return toCamel(result);
}

export const holdRoutes: RouteDef[] = [
  { method: "POST", path: "hold-invoices", handler: createHoldInvoice },
  { method: "GET", path: "hold-invoices", handler: listHoldInvoices },
  { method: "GET", path: "hold-invoices/:id", handler: getHoldInvoice },
  { method: "POST", path: "hold-invoices/:id/process", handler: processHoldInvoice },
];
