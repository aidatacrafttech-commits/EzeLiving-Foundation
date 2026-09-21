import { z } from "zod";

import { ApiError, db, recordAudit, requireUser, toCamel, unwrap, type Ctx, type RouteDef } from "./core.server";

const STOCK_EMBED = "*, product:products(*), warehouse:warehouses(*)";

const adjustSchema = z.object({
  productId: z.number().int(),
  warehouseId: z.number().int(),
  changeQty: z.number().int().refine((n) => n !== 0, "changeQty must not be zero"),
  reorderLevel: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(1).optional(),
});

async function adjustStock(ctx: Ctx) {
  const data = adjustSchema.parse(ctx.body);
  const actor = requireUser(ctx);

  const { data: existing } = await db
    .from("stock")
    .select(STOCK_EMBED)
    .eq("product_id", data.productId)
    .eq("warehouse_id", data.warehouseId)
    .maybeSingle();

  const previousQty = existing?.quantity ?? 0;
  const newQty = previousQty + data.changeQty;
  if (newQty < 0) {
    throw new ApiError(400, "Adjustment would result in negative stock");
  }

  const nowIso = new Date().toISOString();
  let stock: any;
  if (existing) {
    stock = unwrap(
      await db
        .from("stock")
        .update({
          quantity: newQty,
          ...(data.reorderLevel !== undefined ? { reorder_level: data.reorderLevel } : {}),
          updated_at: nowIso,
        })
        .eq("id", existing.id)
        .select(STOCK_EMBED)
        .single()
    );
  } else {
    stock = unwrap(
      await db
        .from("stock")
        .insert({
          product_id: data.productId,
          warehouse_id: data.warehouseId,
          quantity: newQty,
          reorder_level: data.reorderLevel ?? 0,
          updated_at: nowIso,
        })
        .select(STOCK_EMBED)
        .single()
    );
  }

  await db.from("stock_ledger").insert({
    product_id: data.productId,
    warehouse_id: data.warehouseId,
    change_qty: data.changeQty,
    previous_qty: previousQty,
    balance_qty: newQty,
    reference_type: "adjustment",
    performed_by_id: actor.id,
    reason: data.reason ?? null,
  });

  await recordAudit({
    userId: actor.id,
    action: "STOCK_ADJUSTMENT",
    entityType: "Product",
    entityId: data.productId,
    metadata: {
      productName: stock.product.name,
      warehouseId: data.warehouseId,
      warehouseName: stock.warehouse.name,
      previousQty,
      changeQty: data.changeQty,
      newQty,
      reason: data.reason ?? null,
    },
  });

  return toCamel(stock);
}

const transferSchema = z.object({
  productId: z.number().int(),
  fromWarehouseId: z.number().int(),
  toWarehouseId: z.number().int(),
  qty: z.number().int().positive(),
  reason: z.string().trim().min(1).optional(),
});

async function transferStock(ctx: Ctx) {
  const data = transferSchema.parse(ctx.body);
  const actor = requireUser(ctx);

  if (data.fromWarehouseId === data.toWarehouseId) {
    throw new ApiError(400, "Source and destination warehouse must differ");
  }

  const [{ data: product }, { data: fromWarehouse }, { data: toWarehouse }] = await Promise.all([
    db.from("products").select("*").eq("id", data.productId).maybeSingle(),
    db.from("warehouses").select("*").eq("id", data.fromWarehouseId).maybeSingle(),
    db.from("warehouses").select("*").eq("id", data.toWarehouseId).maybeSingle(),
  ]);
  if (!product) throw new ApiError(404, "Product not found");
  if (!fromWarehouse || !toWarehouse) throw new ApiError(404, "Warehouse not found");

  const { data: fromStock } = await db
    .from("stock")
    .select("*")
    .eq("product_id", data.productId)
    .eq("warehouse_id", data.fromWarehouseId)
    .maybeSingle();
  const fromPreviousQty = fromStock?.quantity ?? 0;
  if (fromPreviousQty < data.qty) {
    throw new ApiError(
      400,
      `Insufficient stock at "${fromWarehouse.name}" (available: ${fromPreviousQty}, requested: ${data.qty})`
    );
  }
  const fromNewQty = fromPreviousQty - data.qty;

  const { data: toStock } = await db
    .from("stock")
    .select("*")
    .eq("product_id", data.productId)
    .eq("warehouse_id", data.toWarehouseId)
    .maybeSingle();
  const toPreviousQty = toStock?.quantity ?? 0;
  const toNewQty = toPreviousQty + data.qty;

  const nowIso = new Date().toISOString();

  await db
    .from("stock")
    .update({ quantity: fromNewQty, updated_at: nowIso })
    .eq("product_id", data.productId)
    .eq("warehouse_id", data.fromWarehouseId);

  if (toStock) {
    await db
      .from("stock")
      .update({ quantity: toNewQty, updated_at: nowIso })
      .eq("product_id", data.productId)
      .eq("warehouse_id", data.toWarehouseId);
  } else {
    await db.from("stock").insert({
      product_id: data.productId,
      warehouse_id: data.toWarehouseId,
      quantity: toNewQty,
      reorder_level: 0,
      updated_at: nowIso,
    });
  }

  const transfer: any = unwrap(
    await db
      .from("stock_transfers")
      .insert({
        product_id: data.productId,
        from_warehouse_id: data.fromWarehouseId,
        to_warehouse_id: data.toWarehouseId,
        qty: data.qty,
        from_previous_qty: fromPreviousQty,
        from_new_qty: fromNewQty,
        to_previous_qty: toPreviousQty,
        to_new_qty: toNewQty,
        performed_by_id: actor.id,
        reason: data.reason ?? null,
      })
      .select("*")
      .single()
  );

  await db.from("stock_ledger").insert([
    {
      product_id: data.productId,
      warehouse_id: data.fromWarehouseId,
      change_qty: -data.qty,
      previous_qty: fromPreviousQty,
      balance_qty: fromNewQty,
      reference_type: "transfer",
      reference_id: transfer.id,
      performed_by_id: actor.id,
      reason: data.reason ?? null,
    },
    {
      product_id: data.productId,
      warehouse_id: data.toWarehouseId,
      change_qty: data.qty,
      previous_qty: toPreviousQty,
      balance_qty: toNewQty,
      reference_type: "transfer",
      reference_id: transfer.id,
      performed_by_id: actor.id,
      reason: data.reason ?? null,
    },
  ]);

  await recordAudit({
    userId: actor.id,
    action: "STOCK_TRANSFER",
    entityType: "StockTransfer",
    entityId: transfer.id,
    metadata: {
      productName: product.name,
      fromWarehouseId: data.fromWarehouseId,
      fromWarehouseName: fromWarehouse.name,
      toWarehouseId: data.toWarehouseId,
      toWarehouseName: toWarehouse.name,
      qty: data.qty,
      fromPreviousQty,
      fromNewQty,
      toPreviousQty,
      toNewQty,
      reason: data.reason ?? null,
    },
  });

  return toCamel(transfer);
}

const markDamagedSchema = z.object({
  productId: z.number().int(),
  warehouseId: z.number().int(),
  qty: z.number().int().positive(),
  source: z.enum(["showroom", "transit"]).default("showroom"),
});

async function markDamaged(ctx: Ctx) {
  const data = markDamagedSchema.parse(ctx.body);
  const actor = requireUser(ctx);

  const { data: existing } = await db
    .from("stock")
    .select(STOCK_EMBED)
    .eq("product_id", data.productId)
    .eq("warehouse_id", data.warehouseId)
    .maybeSingle();

  if (!existing || existing.quantity < data.qty) {
    throw new ApiError(
      400,
      `Cannot mark ${data.qty} as damaged — only ${existing?.quantity ?? 0} sellable units available at this warehouse`
    );
  }

  const previousQty = existing.quantity;
  const newQty = existing.quantity - data.qty;
  const newDamagedQty = existing.damaged_quantity + data.qty;
  const newDamagedQtyTransit = existing.damaged_quantity_transit + (data.source === "transit" ? data.qty : 0);

  const stock = unwrap(
    await db
      .from("stock")
      .update({
        quantity: newQty,
        damaged_quantity: newDamagedQty,
        damaged_quantity_transit: newDamagedQtyTransit,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single()
  );

  await db.from("stock_ledger").insert({
    product_id: data.productId,
    warehouse_id: data.warehouseId,
    change_qty: -data.qty,
    previous_qty: previousQty,
    balance_qty: newQty,
    reference_type: "adjustment",
    performed_by_id: actor.id,
    reason: data.source === "transit" ? "Marked damaged (transit)" : "Marked damaged",
  });

  await recordAudit({
    userId: actor.id,
    action: "DAMAGE",
    entityType: "Product",
    entityId: data.productId,
    metadata: {
      productName: existing.product.name,
      warehouseId: data.warehouseId,
      warehouseName: existing.warehouse.name,
      qty: data.qty,
      previousQty,
      newQty,
      damageSource: data.source,
    },
  });

  return toCamel(stock);
}

async function listLowStock(_ctx: Ctx) {
  const { data: rows } = await db
    .from("stock")
    .select(STOCK_EMBED)
    .order("quantity", { ascending: true });

  const lowStock = (rows ?? [])
    .filter((s: any) => s.product.is_active && s.quantity <= s.reorder_level)
    .map((s: any) => ({
      productId: s.product_id,
      productName: s.product.name,
      sku: s.product.sku,
      warehouseId: s.warehouse_id,
      warehouseName: s.warehouse.name,
      quantity: s.quantity,
      reorderLevel: s.reorder_level,
    }));

  return lowStock;
}

async function listDamagedStock(ctx: Ctx) {
  const sourceParam = ctx.query.get("source");
  const sourceFilter = sourceParam === "transit" || sourceParam === "showroom" ? sourceParam : undefined;

  const { data: rows } = await db
    .from("stock")
    .select(STOCK_EMBED)
    .gt("damaged_quantity", 0)
    .order("updated_at", { ascending: false });

  const result: Array<{
    productId: number;
    productName: string;
    sku: string;
    warehouseId: number;
    warehouseName: string;
    damagedQuantity: number;
    damageSource: "transit" | "showroom";
    updatedAt: string;
  }> = [];

  for (const s of rows ?? []) {
    const transitQty = s.damaged_quantity_transit;
    const showroomQty = s.damaged_quantity - s.damaged_quantity_transit;

    if (transitQty > 0 && (!sourceFilter || sourceFilter === "transit")) {
      result.push({
        productId: s.product_id,
        productName: s.product.name,
        sku: s.product.sku,
        warehouseId: s.warehouse_id,
        warehouseName: s.warehouse.name,
        damagedQuantity: transitQty,
        damageSource: "transit",
        updatedAt: s.updated_at,
      });
    }
    if (showroomQty > 0 && (!sourceFilter || sourceFilter === "showroom")) {
      result.push({
        productId: s.product_id,
        productName: s.product.name,
        sku: s.product.sku,
        warehouseId: s.warehouse_id,
        warehouseName: s.warehouse.name,
        damagedQuantity: showroomQty,
        damageSource: "showroom",
        updatedAt: s.updated_at,
      });
    }
  }

  return result;
}

export const stockRoutes: RouteDef[] = [
  { method: "GET", path: "stock/low", handler: listLowStock },
  { method: "GET", path: "stock/damaged", handler: listDamagedStock },
  { method: "POST", path: "stock/adjust", handler: adjustStock },
  { method: "POST", path: "stock/transfer", handler: transferStock },
  { method: "POST", path: "stock/mark-damaged", handler: markDamaged },
];
