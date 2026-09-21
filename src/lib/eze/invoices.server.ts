// Invoices, returns, cancellation, deletion, PDF and email routes ported
// from the original Express/Prisma backend (server/src/controllers/invoices.controller.ts).
import { z } from "zod";

import {
  ApiError,
  db,
  nextDocumentNumber,
  recordAudit,
  requireAdmin,
  requireUser,
  toCamel,
  unwrap,
  type Ctx,
  type RouteDef,
} from "./core.server";

/* ------------------------------------------------------------------ */
/* Money helpers — plain-number arithmetic done in integer cents so it  */
/* behaves the same as Prisma.Decimal(…, 2) rounding did originally.    */
/* ------------------------------------------------------------------ */

function toCents(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100);
}

function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

/* ------------------------------------------------------------------ */
/* Loading helpers                                                     */
/* ------------------------------------------------------------------ */

const INVOICE_FULL_SELECT =
  "*, customer:customers(*), warehouse:warehouses(*), items:invoice_items(*, product:products(*)), returns:returns(*, items:return_items(*, product:products(*)))";

async function loadInvoiceFull(id: number): Promise<any | null> {
  const { data } = await db.from("invoices").select(INVOICE_FULL_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const returns = ((data as any).returns ?? []).slice().sort(
    (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return { ...(data as any), returns };
}

async function loadInvoiceByIdempotencyKey(key: string): Promise<any | null> {
  const { data } = await db
    .from("invoices")
    .select("*, customer:customers(*), warehouse:warehouses(*), items:invoice_items(*)")
    .eq("idempotency_key", key)
    .maybeSingle();
  return data ?? null;
}

/* ------------------------------------------------------------------ */
/* Create invoice                                                      */
/* ------------------------------------------------------------------ */

const createInvoiceSchema = z.object({
  warehouseId: z.number().int(),
  customerId: z.number().int().optional(),
  paymentMode: z.enum(["cash", "card", "upi"]),
  couponCode: z.string().trim().min(1).optional(),
  packagingCharge: z.number().nonnegative().default(0),
  transportCharge: z.number().nonnegative().default(0),
  idempotencyKey: z.string().trim().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        qty: z.number().int().positive(),
        barcodeScanned: z.string().optional(),
        discount: z.number().nonnegative().default(0),
      })
    )
    .min(1, "Cart must contain at least one item"),
});

async function createInvoice(ctx: Ctx) {
  const actor = requireUser(ctx);
  const data = createInvoiceSchema.parse(ctx.body);

  if (data.idempotencyKey) {
    const existing = await loadInvoiceByIdempotencyKey(data.idempotencyKey);
    if (existing) return toCamel(existing);
  }

  const warehouse = unwrap(await db.from("warehouses").select("*").eq("id", data.warehouseId).maybeSingle());
  if (!warehouse) throw new ApiError(400, "Warehouse not found");

  let customer: any = null;
  if (data.customerId !== undefined) {
    customer = unwrap(await db.from("customers").select("*").eq("id", data.customerId).maybeSingle());
    if (!customer) throw new ApiError(400, "Customer not found");
  }

  const productIds = data.items.map((i) => i.productId);
  const products = unwrap(await db.from("products").select("*").in("id", productIds)) ?? [];
  const productMap = new Map(products.map((p: any) => [p.id, p]));

  for (const item of data.items) {
    if (!productMap.has(item.productId)) throw new ApiError(400, `Product ${item.productId} not found`);
  }

  const stockRows =
    unwrap(
      await db.from("stock").select("*").eq("warehouse_id", data.warehouseId).in("product_id", productIds)
    ) ?? [];
  const stockMap = new Map(stockRows.map((s: any) => [s.product_id, s]));

  for (const item of data.items) {
    const stock: any = stockMap.get(item.productId);
    if (!stock || stock.quantity < item.qty) {
      const product = productMap.get(item.productId)!;
      throw new ApiError(
        400,
        `Insufficient stock for "${product.name}" at the selected warehouse (available: ${stock?.quantity ?? 0}, requested: ${item.qty})`
      );
    }
  }

  let subtotalCents = 0;
  let taxCents = 0;
  const itemsData = data.items.map((item) => {
    const product: any = productMap.get(item.productId)!;
    const price = Number(product.selling_price);
    const lineBaseCents = toCents(price) * item.qty;
    const itemDiscountCents = Math.min(toCents(item.discount), lineBaseCents);
    const discountedBaseCents = lineBaseCents - itemDiscountCents;
    const lineTaxCents = Math.round((discountedBaseCents * Number(product.tax_percent)) / 100);
    const lineTotalCents = discountedBaseCents + lineTaxCents;
    subtotalCents += discountedBaseCents;
    taxCents += lineTaxCents;
    return {
      product_id: product.id,
      barcode_scanned: item.barcodeScanned ?? product.barcode,
      qty: item.qty,
      mrp: centsToNumber(toCents(product.mrp)),
      price,
      discount: centsToNumber(itemDiscountCents),
      tax_amount: centsToNumber(lineTaxCents),
      line_total: centsToNumber(lineTotalCents),
    };
  });

  let coupon: { code: string; discountPercent: number } | null = null;
  let couponDiscountCents = 0;
  if (data.couponCode) {
    const found: any = unwrap(
      await db.from("coupons").select("*").ilike("code", data.couponCode).eq("is_active", true).maybeSingle()
    );
    if (!found) throw new ApiError(400, "Invalid or inactive coupon code");
    coupon = { code: found.code, discountPercent: Number(found.discount_percent) };
    couponDiscountCents = Math.round((subtotalCents * coupon.discountPercent) / 100);
  }

  const packagingCents = toCents(data.packagingCharge);
  const transportCents = toCents(data.transportCharge);
  const grandTotalCents = subtotalCents + taxCents - couponDiscountCents + packagingCents + transportCents;
  if (grandTotalCents < 0) throw new ApiError(400, "Coupon discount cannot exceed subtotal plus tax");

  const invoiceNumber = await nextDocumentNumber("INVOICE", process.env["INVOICE_PREFIX"] ?? "INV-");

  const insertPayload: Record<string, unknown> = {
    invoice_number: invoiceNumber,
    customer_id: data.customerId ?? null,
    warehouse_id: data.warehouseId,
    idempotency_key: data.idempotencyKey ?? null,
    subtotal: centsToNumber(subtotalCents),
    tax_amount: centsToNumber(taxCents),
    packaging_charge: centsToNumber(packagingCents),
    transport_charge: centsToNumber(transportCents),
    grand_total: centsToNumber(grandTotalCents),
    payment_mode: data.paymentMode,
    status: "paid",
    created_by_id: actor.id,
    customer_name_snapshot: customer?.name ?? null,
    customer_phone_snapshot: customer?.phone ?? null,
    customer_gst_snapshot: customer?.gst_number ?? null,
    customer_address_snapshot: customer?.address ?? null,
    warehouse_name_snapshot: warehouse.name,
    warehouse_location_snapshot: (warehouse as any).location,
  };
  if (coupon) {
    insertPayload["coupon_code"] = coupon.code;
    insertPayload["coupon_discount_percent"] = coupon.discountPercent;
    insertPayload["coupon_discount_amount"] = centsToNumber(couponDiscountCents);
  }

  const { data: createdInvoice, error: createErr } = await db
    .from("invoices")
    .insert(insertPayload as any)
    .select("*")
    .single();

  if (createErr) {
    if (
      data.idempotencyKey &&
      (createErr as any).code === "23505" &&
      String((createErr as any).message ?? "").includes("idempotency_key")
    ) {
      const existing = await loadInvoiceByIdempotencyKey(data.idempotencyKey);
      if (existing) return toCamel(existing);
    }
    throw new ApiError(400, createErr.message);
  }

  const invoiceId = (createdInvoice as any).id;

  // Insert line items.
  const { error: itemsErr } = await db
    .from("invoice_items")
    .insert(itemsData.map((i) => ({ ...i, invoice_id: invoiceId })) as any);
  if (itemsErr) {
    await db.from("invoices").delete().eq("id", invoiceId);
    throw new ApiError(400, `Failed to save invoice items: ${itemsErr.message}`);
  }

  // Deduct stock and write ledger rows, tracking what's been applied so it
  // can be rolled back if a later item fails.
  const appliedStockChanges: Array<{ stockId: number; qty: number }> = [];
  try {
    for (const item of data.items) {
      const stock: any = stockMap.get(item.productId)!;
      const product: any = productMap.get(item.productId)!;

      const { data: freshStock } = await db.from("stock").select("id, quantity").eq("id", stock.id).single();
      if (!freshStock || freshStock.quantity < item.qty) {
        throw new ApiError(400, `Insufficient stock for "${product.name}" — someone else may have just sold it`);
      }
      const newQty = freshStock.quantity - item.qty;
      const { data: updatedRows, error: updErr } = await db
        .from("stock")
        .update({ quantity: newQty } as any)
        .eq("id", stock.id)
        .eq("quantity", freshStock.quantity)
        .select("id");
      if (updErr || !updatedRows || updatedRows.length === 0) {
        throw new ApiError(400, `Insufficient stock for "${product.name}" — someone else may have just sold it`);
      }
      appliedStockChanges.push({ stockId: stock.id, qty: item.qty });

      await db.from("stock_ledger").insert({
        product_id: item.productId,
        warehouse_id: data.warehouseId,
        change_qty: -item.qty,
        previous_qty: freshStock.quantity,
        balance_qty: newQty,
        reference_type: "invoice",
        reference_id: invoiceId,
        performed_by_id: actor.id,
      } as any);
    }
  } catch (err) {
    // Roll back everything applied so far.
    for (const applied of appliedStockChanges.reverse()) {
      const { data: row } = await db.from("stock").select("quantity").eq("id", applied.stockId).single();
      if (row) {
        await db
          .from("stock")
          .update({ quantity: row.quantity + applied.qty } as any)
          .eq("id", applied.stockId);
      }
    }
    await db.from("stock_ledger").delete().eq("reference_type", "invoice").eq("reference_id", invoiceId);
    await db.from("invoice_items").delete().eq("invoice_id", invoiceId);
    await db.from("invoices").delete().eq("id", invoiceId);
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, "Failed to complete the sale — please try again");
  }

  await recordAudit({
    userId: actor.id,
    action: "SALE",
    entityType: "Invoice",
    entityId: invoiceId,
    metadata: {
      invoiceNumber,
      warehouseId: data.warehouseId,
      grandTotal: centsToNumber(grandTotalCents).toFixed(2),
      itemCount: data.items.length,
      couponCode: coupon?.code ?? null,
    },
  });

  const full = await loadInvoiceFull(invoiceId);

  // Best-effort — never throws, mirrors attemptInvoiceEmail in the original.
  void attemptInvoiceEmail(invoiceId).catch(() => {});

  return toCamel(full);
}

/* ------------------------------------------------------------------ */
/* List / get                                                          */
/* ------------------------------------------------------------------ */

async function listInvoices(ctx: Ctx) {
  requireUser(ctx);
  const from = ctx.query.get("from");
  const to = ctx.query.get("to");
  const customer = ctx.query.get("customer");
  const product = ctx.query.get("product");
  const invoiceNumber = ctx.query.get("invoiceNumber");

  let query = db
    .from("invoices")
    .select("*, customer:customers(*), warehouse:warehouses(*), items:invoice_items(*, product:products(*))")
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", new Date(from).toISOString());
  if (to) query = query.lte("created_at", new Date(to).toISOString());
  if (invoiceNumber) {
    const escaped = invoiceNumber.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.ilike("invoice_number", `%${escaped}%`);
  }

  let invoices = unwrap(await query) ?? [];

  if (customer) {
    const needle = customer.toLowerCase();
    invoices = invoices.filter((inv: any) => {
      const name = (inv.customer?.name ?? "").toLowerCase();
      const phone = inv.customer?.phone ?? "";
      return name.includes(needle) || phone.includes(customer);
    });
  }
  if (product) {
    const needle = product.toLowerCase();
    invoices = invoices.filter((inv: any) =>
      (inv.items ?? []).some((it: any) => (it.product?.name ?? "").toLowerCase().includes(needle))
    );
  }

  invoices = invoices.slice(0, 200);
  return toCamel(invoices);
}

async function getInvoice(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params["id"]);
  const invoice = await loadInvoiceFull(id);
  if (!invoice) throw new ApiError(404, "Invoice not found");
  return toCamel(invoice);
}

/* ------------------------------------------------------------------ */
/* Cancel                                                               */
/* ------------------------------------------------------------------ */

async function cancelInvoice(ctx: Ctx) {
  const actor = requireUser(ctx);
  const id = Number(ctx.params["id"]);

  const { data: invoice } = await db
    .from("invoices")
    .select("*, items:invoice_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) throw new ApiError(404, "Invoice not found");
  if ((invoice as any).status !== "paid") {
    throw new ApiError(400, `Invoice is already ${(invoice as any).status}, cannot cancel`);
  }

  for (const item of (invoice as any).items as any[]) {
    const returnable = item.qty - item.returned_qty;
    if (returnable <= 0) continue;

    const { data: existingStock } = await db
      .from("stock")
      .select("*")
      .eq("product_id", item.product_id)
      .eq("warehouse_id", (invoice as any).warehouse_id)
      .maybeSingle();

    let previousQty = 0;
    let newQty = returnable;
    if (existingStock) {
      previousQty = existingStock.quantity;
      newQty = existingStock.quantity + returnable;
      await db.from("stock").update({ quantity: newQty } as any).eq("id", existingStock.id);
    } else {
      await db.from("stock").insert({
        product_id: item.product_id,
        warehouse_id: (invoice as any).warehouse_id,
        quantity: returnable,
        reorder_level: 0,
      } as any);
    }

    await db.from("stock_ledger").insert({
      product_id: item.product_id,
      warehouse_id: (invoice as any).warehouse_id,
      change_qty: returnable,
      previous_qty: previousQty,
      balance_qty: newQty,
      reference_type: "invoice",
      reference_id: (invoice as any).id,
      performed_by_id: actor.id,
      reason: "Invoice cancelled",
    } as any);
  }

  const { data: updated, error: updErr } = await db
    .from("invoices")
    .update({ status: "cancelled" } as any)
    .eq("id", id)
    .select("*, items:invoice_items(*, product:products(*)), customer:customers(*), warehouse:warehouses(*)")
    .single();
  if (updErr) throw new ApiError(400, updErr.message);

  await recordAudit({
    userId: actor.id,
    action: "INVOICE_CANCELLED",
    entityType: "Invoice",
    entityId: (invoice as any).id,
    metadata: { invoiceNumber: (invoice as any).invoice_number, warehouseId: (invoice as any).warehouse_id },
  });

  return toCamel(updated);
}

/* ------------------------------------------------------------------ */
/* Delete (admin-only)                                                  */
/* ------------------------------------------------------------------ */

async function deleteInvoice(ctx: Ctx) {
  const actor = requireAdmin(ctx);
  const id = Number(ctx.params["id"]);

  const { data: invoice } = await db.from("invoices").select("*").eq("id", id).maybeSingle();
  if (!invoice) throw new ApiError(404, "Invoice not found");
  if ((invoice as any).status === "paid") throw new ApiError(400, "Cancel this invoice before deleting it");

  const { data: returns } = await db.from("returns").select("id").eq("invoice_id", id);
  const returnIds = (returns ?? []).map((r: any) => r.id);
  if (returnIds.length > 0) {
    await db.from("return_items").delete().in("return_id", returnIds);
    await db.from("returns").delete().in("id", returnIds);
  }
  await db.from("invoice_items").delete().eq("invoice_id", id);
  await db.from("invoices").delete().eq("id", id);

  await recordAudit({
    userId: actor.id,
    action: "INVOICE_DELETED",
    entityType: "Invoice",
    entityId: id,
    metadata: { invoiceNumber: (invoice as any).invoice_number, warehouseId: (invoice as any).warehouse_id },
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Returns                                                              */
/* ------------------------------------------------------------------ */

const createReturnSchema = z.object({
  items: z
    .array(
      z.object({
        invoiceItemId: z.number().int(),
        qty: z.number().int().positive(),
        reason: z.enum(["normal", "defective"]),
      })
    )
    .min(1, "Select at least one item to return"),
});

async function createReturn(ctx: Ctx) {
  const actor = requireUser(ctx);
  const invoiceId = Number(ctx.params["id"]);
  const data = createReturnSchema.parse(ctx.body);

  const { data: invoice } = await db
    .from("invoices")
    .select("*, items:invoice_items(*, product:products(*))")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) throw new ApiError(404, "Invoice not found");
  if ((invoice as any).status !== "paid") {
    throw new ApiError(400, `Invoice is ${(invoice as any).status}, cannot process a return against it`);
  }

  const invoiceItemMap = new Map(((invoice as any).items as any[]).map((i) => [i.id, i]));
  let totalRefundCents = 0;

  const itemsData = data.items.map((reqItem) => {
    const invoiceItem: any = invoiceItemMap.get(reqItem.invoiceItemId);
    if (!invoiceItem) throw new ApiError(400, `Invoice item ${reqItem.invoiceItemId} does not belong to this invoice`);
    const returnable = invoiceItem.qty - invoiceItem.returned_qty;
    if (reqItem.qty > returnable) {
      throw new ApiError(
        400,
        `Cannot return ${reqItem.qty} of "${invoiceItem.product.name}" — only ${returnable} left returnable`
      );
    }
    const refundCents = Math.round((toCents(invoiceItem.line_total) / invoiceItem.qty) * reqItem.qty);
    totalRefundCents += refundCents;
    return {
      invoiceItemId: invoiceItem.id,
      productId: invoiceItem.product_id,
      qty: reqItem.qty,
      reason: reqItem.reason,
      refundAmount: centsToNumber(refundCents),
    };
  });

  const returnNumber = await nextDocumentNumber("RETURN", "RET-");
  const { data: createdReturn, error: retErr } = await db
    .from("returns")
    .insert({
      return_number: returnNumber,
      invoice_id: (invoice as any).id,
      total_refund: centsToNumber(totalRefundCents),
      created_by_id: actor.id,
    } as any)
    .select("*")
    .single();
  if (retErr) throw new ApiError(400, retErr.message);

  const returnId = (createdReturn as any).id;
  const { error: itemsErr } = await db.from("return_items").insert(
    itemsData.map((i) => ({
      return_id: returnId,
      invoice_item_id: i.invoiceItemId,
      product_id: i.productId,
      qty: i.qty,
      reason: i.reason,
      refund_amount: i.refundAmount,
    })) as any
  );
  if (itemsErr) {
    await db.from("returns").delete().eq("id", returnId);
    throw new ApiError(400, `Failed to save return items: ${itemsErr.message}`);
  }

  for (const reqItem of data.items) {
    const invoiceItem: any = invoiceItemMap.get(reqItem.invoiceItemId)!;

    await db
      .from("invoice_items")
      .update({ returned_qty: invoiceItem.returned_qty + reqItem.qty } as any)
      .eq("id", invoiceItem.id);

    if (reqItem.reason === "normal") {
      const { data: existingStock } = await db
        .from("stock")
        .select("*")
        .eq("product_id", invoiceItem.product_id)
        .eq("warehouse_id", (invoice as any).warehouse_id)
        .maybeSingle();

      let previousQty = 0;
      let newQty = reqItem.qty;
      if (existingStock) {
        previousQty = existingStock.quantity;
        newQty = existingStock.quantity + reqItem.qty;
        await db.from("stock").update({ quantity: newQty } as any).eq("id", existingStock.id);
      } else {
        await db.from("stock").insert({
          product_id: invoiceItem.product_id,
          warehouse_id: (invoice as any).warehouse_id,
          quantity: reqItem.qty,
          reorder_level: 0,
        } as any);
      }

      await db.from("stock_ledger").insert({
        product_id: invoiceItem.product_id,
        warehouse_id: (invoice as any).warehouse_id,
        change_qty: reqItem.qty,
        previous_qty: previousQty,
        balance_qty: newQty,
        reference_type: "return",
        reference_id: returnId,
        performed_by_id: actor.id,
        reason: `Customer return (${reqItem.reason})`,
      } as any);
    } else {
      const { data: existingStock } = await db
        .from("stock")
        .select("*")
        .eq("product_id", invoiceItem.product_id)
        .eq("warehouse_id", (invoice as any).warehouse_id)
        .maybeSingle();
      if (existingStock) {
        await db
          .from("stock")
          .update({ damaged_quantity: existingStock.damaged_quantity + reqItem.qty } as any)
          .eq("id", existingStock.id);
      } else {
        await db.from("stock").insert({
          product_id: invoiceItem.product_id,
          warehouse_id: (invoice as any).warehouse_id,
          damaged_quantity: reqItem.qty,
          reorder_level: 0,
        } as any);
      }
    }
  }

  await recordAudit({
    userId: actor.id,
    action: "RETURN",
    entityType: "Return",
    entityId: returnId,
    metadata: {
      returnNumber,
      invoiceId: (invoice as any).id,
      invoiceNumber: (invoice as any).invoice_number,
      totalRefund: centsToNumber(totalRefundCents).toFixed(2),
    },
  });

  const { data: full } = await db
    .from("returns")
    .select("*, items:return_items(*, product:products(*))")
    .eq("id", returnId)
    .single();

  return toCamel(full);
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

interface InvoicePdfItem {
  product: { name: string; sku: string };
  qty: number;
  mrp: string;
  price: string;
  discount: string;
  taxAmount: string;
  lineTotal: string;
}

interface InvoicePdfData {
  invoiceNumber: string;
  createdAt: Date;
  paymentMode: string;
  status: string;
  subtotal: string;
  taxAmount: string;
  couponCode?: string | null;
  couponDiscountPercent?: string | null;
  couponDiscountAmount?: string | null;
  packagingCharge?: string;
  transportCharge?: string;
  grandTotal: string;
  customer: { name: string; phone: string | null; gstNumber: string | null } | null;
  warehouse: { name: string; location: string | null };
  items: InvoicePdfItem[];
}

async function loadInvoicePdfData(id: number): Promise<{ invoice: any; pdfData: InvoicePdfData } | null> {
  const invoice = await loadInvoiceFull(id);
  if (!invoice) return null;

  const customerName = invoice.customer_name_snapshot ?? invoice.customer?.name ?? null;
  const customerPhone = invoice.customer_phone_snapshot ?? invoice.customer?.phone ?? null;
  const customerGst = invoice.customer_gst_snapshot ?? invoice.customer?.gst_number ?? null;
  const warehouseName = invoice.warehouse_name_snapshot ?? invoice.warehouse?.name;
  const warehouseLocation = invoice.warehouse_location_snapshot ?? invoice.warehouse?.location;

  const pdfData: InvoicePdfData = {
    invoiceNumber: invoice.invoice_number,
    createdAt: new Date(invoice.created_at),
    paymentMode: invoice.payment_mode,
    status: invoice.status,
    subtotal: Number(invoice.subtotal).toFixed(2),
    taxAmount: Number(invoice.tax_amount).toFixed(2),
    couponCode: invoice.coupon_code,
    couponDiscountPercent: invoice.coupon_discount_percent ? Number(invoice.coupon_discount_percent).toFixed(2) : null,
    couponDiscountAmount: invoice.coupon_discount_amount ? Number(invoice.coupon_discount_amount).toFixed(2) : null,
    packagingCharge: Number(invoice.packaging_charge).toFixed(2),
    transportCharge: Number(invoice.transport_charge).toFixed(2),
    grandTotal: Number(invoice.grand_total).toFixed(2),
    customer: customerName ? { name: customerName, phone: customerPhone, gstNumber: customerGst } : null,
    warehouse: { name: warehouseName, location: warehouseLocation ?? null },
    items: (invoice.items ?? []).map((item: any) => ({
      product: { name: item.product?.name ?? "", sku: item.product?.sku ?? "" },
      qty: item.qty,
      mrp: Number(item.mrp).toFixed(2),
      price: Number(item.price).toFixed(2),
      discount: Number(item.discount).toFixed(2),
      taxAmount: Number(item.tax_amount).toFixed(2),
      lineTotal: Number(item.line_total).toFixed(2),
    })),
  };

  return { invoice, pdfData };
}

/* --- Minimal, dependency-free PDF 1.4 writer (Helvetica text lines) --- */

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

interface PdfOp {
  text: string;
  x: number;
  y: number;
  size: number;
  bold?: boolean;
  color?: [number, number, number];
  rotateDeg?: number;
}

function buildInvoicePdf(invoice: InvoicePdfData): Uint8Array {
  const ops: PdfOp[] = [];
  const companyName = process.env["COMPANY_NAME"] ?? "Company Name";
  const companyAddress = process.env["COMPANY_ADDRESS"] ?? "";
  const companyGst = process.env["COMPANY_GST_NUMBER"] ?? "";

  let y = 800;

  if (invoice.status !== "paid") {
    ops.push({
      text: invoice.status.toUpperCase(),
      x: 90,
      y: 420,
      size: 72,
      bold: true,
      color: [0.88, 0.11, 0.28],
      rotateDeg: 35,
    });
  }

  ops.push({ text: companyName, x: 40, y, size: 18, bold: true });
  y -= 16;
  if (companyAddress) {
    ops.push({ text: companyAddress, x: 40, y, size: 9, color: [0.33, 0.33, 0.33] });
    y -= 12;
  }
  if (companyGst) {
    ops.push({ text: `GSTIN: ${companyGst}`, x: 40, y, size: 9, color: [0.33, 0.33, 0.33] });
    y -= 12;
  }

  y = 800;
  ops.push({ text: `Invoice ${invoice.invoiceNumber}`, x: 380, y, size: 14, bold: true });
  y -= 16;
  if (invoice.status !== "paid") {
    ops.push({ text: `STATUS: ${invoice.status.toUpperCase()}`, x: 380, y, size: 11, color: [0.88, 0.11, 0.28] });
    y -= 14;
  }
  ops.push({ text: `Date: ${invoice.createdAt.toLocaleString()}`, x: 380, y, size: 9 });
  y -= 12;
  ops.push({ text: `Payment mode: ${invoice.paymentMode.toUpperCase()}`, x: 380, y, size: 9 });
  y -= 12;
  ops.push({
    text: `Billed from: ${invoice.warehouse.name}${invoice.warehouse.location ? ` (${invoice.warehouse.location})` : ""}`,
    x: 380,
    y,
    size: 9,
  });

  y = 745;
  if (invoice.customer) {
    ops.push({ text: "Bill To:", x: 40, y, size: 10, bold: true });
    y -= 12;
    ops.push({ text: invoice.customer.name, x: 40, y, size: 9 });
    y -= 12;
    if (invoice.customer.phone) {
      ops.push({ text: invoice.customer.phone, x: 40, y, size: 9 });
      y -= 12;
    }
    if (invoice.customer.gstNumber) {
      ops.push({ text: `GSTIN: ${invoice.customer.gstNumber}`, x: 40, y, size: 9 });
      y -= 12;
    }
  }

  y -= 8;
  const columns = [
    { label: "Product", x: 40 },
    { label: "Qty", x: 220 },
    { label: "MRP", x: 260 },
    { label: "Price", x: 310 },
    { label: "Disc.", x: 360 },
    { label: "Tax", x: 410 },
    { label: "Total", x: 460 },
  ];
  for (const col of columns) ops.push({ text: col.label, x: col.x, y, size: 9, bold: true });
  y -= 16;

  for (const item of invoice.items) {
    const row = [
      `${item.product.name} (${item.product.sku})`,
      String(item.qty),
      item.mrp,
      item.price,
      item.discount,
      item.taxAmount,
      item.lineTotal,
    ];
    row.forEach((value, i) => {
      ops.push({ text: value, x: columns[i]!.x, y, size: 9 });
    });
    y -= 16;
  }

  y -= 8;
  const totals: Array<[string, string]> = [
    ["Subtotal", invoice.subtotal],
    ["Tax", invoice.taxAmount],
  ];
  if (invoice.couponCode && invoice.couponDiscountAmount && Number(invoice.couponDiscountAmount) > 0) {
    totals.push([`Coupon (${invoice.couponCode}, ${invoice.couponDiscountPercent}%)`, `-${invoice.couponDiscountAmount}`]);
  }
  if (invoice.packagingCharge && Number(invoice.packagingCharge) > 0) {
    totals.push(["Packaging Charges", invoice.packagingCharge]);
  }
  if (invoice.transportCharge && Number(invoice.transportCharge) > 0) {
    totals.push(["Transport Charges", invoice.transportCharge]);
  }
  for (const [label, value] of totals) {
    ops.push({ text: label, x: 350, y, size: 9 });
    ops.push({ text: value, x: 460, y, size: 9 });
    y -= 14;
  }
  ops.push({ text: "Grand Total", x: 350, y, size: 11, bold: true });
  ops.push({ text: invoice.grandTotal, x: 460, y, size: 11, bold: true });

  // Build content stream.
  let content = "";
  for (const op of ops) {
    const size = op.size;
    const font = op.bold ? "/F2" : "/F1";
    const [r, g, b] = op.color ?? [0, 0, 0];
    const rad = ((op.rotateDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad).toFixed(4);
    const sin = Math.sin(rad).toFixed(4);
    const nsin = (-Math.sin(rad)).toFixed(4);
    content += "BT\n";
    content += `${font} ${size} Tf\n`;
    content += `${r} ${g} ${b} rg\n`;
    content += `${cos} ${sin} ${nsin} ${cos} ${op.x} ${op.y} Tm\n`;
    content += `(${pdfEscape(op.text)}) Tj\n`;
    content += "ET\n";
  }

  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(content);

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  objects.push(`<< /Length ${contentBytes.length} >>\nstream\n${content}endstream`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encoder.encode(pdf);
}

async function downloadInvoicePdf(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params["id"]);
  const loaded = await loadInvoicePdfData(id);
  if (!loaded) throw new ApiError(404, "Invoice not found");

  const bytes = buildInvoicePdf(loaded.pdfData);
  return new Response(bytes as any, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${loaded.pdfData.invoiceNumber}.pdf"`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Email (no SMTP available in this environment — no-op like the       */
/* original's "not configured" path).                                  */
/* ------------------------------------------------------------------ */

interface SendInvoiceEmailResult {
  sent: boolean;
  reason?: string;
}

function smtpConfigured(): boolean {
  return Boolean(process.env["SMTP_HOST"] && process.env["SMTP_USER"] && process.env["SMTP_PASS"]);
}

async function sendInvoiceEmail(_input: {
  to: string;
  customerName: string;
  invoiceNumber: string;
  grandTotal: string;
}): Promise<SendInvoiceEmailResult> {
  if (!smtpConfigured()) {
    return { sent: false, reason: "Email is not configured yet (set SMTP_HOST/SMTP_USER/SMTP_PASS)" };
  }
  // SMTP sending isn't available in this Cloudflare Worker runtime
  // (nodemailer is Node-only). Report the same not-configured style result.
  return { sent: false, reason: "Email sending is not available in this environment" };
}

async function attemptInvoiceEmail(invoiceId: number): Promise<void> {
  try {
    const loaded = await loadInvoicePdfData(invoiceId);
    if (!loaded?.invoice.customer?.email) return;
    const result = await sendInvoiceEmail({
      to: loaded.invoice.customer.email,
      customerName: loaded.invoice.customer.name,
      invoiceNumber: loaded.invoice.invoice_number,
      grandTotal: String(loaded.invoice.grand_total),
    });
    console.log(`Invoice ${loaded.invoice.invoice_number} email: ${result.sent ? "sent" : `skipped (${result.reason})`}`);
  } catch (err) {
    console.error(`Failed to email invoice ${invoiceId}:`, err);
  }
}

async function sendInvoiceEmailNow(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params["id"]);
  const loaded = await loadInvoicePdfData(id);
  if (!loaded) throw new ApiError(404, "Invoice not found");
  if (!loaded.invoice.customer?.email) throw new ApiError(400, "This customer has no email on file");

  const result = await sendInvoiceEmail({
    to: loaded.invoice.customer.email,
    customerName: loaded.invoice.customer.name,
    invoiceNumber: loaded.invoice.invoice_number,
    grandTotal: String(loaded.invoice.grand_total),
  });

  if (!result.sent) throw new ApiError(502, result.reason ?? "Couldn't send the email");
  return { sent: true };
}

/* ------------------------------------------------------------------ */

export const invoiceRoutes: RouteDef[] = [
  { method: "POST", path: "invoices", handler: createInvoice },
  { method: "GET", path: "invoices", handler: listInvoices },
  { method: "GET", path: "invoices/:id", handler: getInvoice },
  { method: "GET", path: "invoices/:id/pdf", handler: downloadInvoicePdf },
  { method: "POST", path: "invoices/:id/cancel", handler: cancelInvoice },
  { method: "DELETE", path: "invoices/:id", handler: deleteInvoice },
  { method: "POST", path: "invoices/:id/return", handler: createReturn },
  { method: "POST", path: "invoices/:id/send-email", handler: sendInvoiceEmailNow },
];
