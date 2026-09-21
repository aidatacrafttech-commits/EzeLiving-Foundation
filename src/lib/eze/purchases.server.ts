import { z } from "zod";

import { ApiError, db, nextDocumentNumber, recordAudit, requireUser, toCamel, unwrap, type Ctx, type RouteDef } from "./core.server";

const createPurchaseSchema = z.object({
  supplierId: z.number().int().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        warehouseId: z.number().int(),
        qty: z.number().int().positive(),
        damagedQty: z.number().int().nonnegative().default(0),
        costPrice: z.number().nonnegative(),
      })
    )
    .min(1, "Purchase must contain at least one item"),
});

async function createPurchase(ctx: Ctx) {
  const actor = requireUser(ctx);
  const data = createPurchaseSchema.parse(ctx.body);

  const productIds = [...new Set(data.items.map((i) => i.productId))];
  const products = unwrap(await db.from("products").select("*").in("id", productIds));
  const productMap = new Map(products.map((p: any) => [p.id, p]));

  for (const item of data.items) {
    if (!productMap.has(item.productId)) {
      throw new ApiError(400, `Product ${item.productId} not found`);
    }
  }

  let totalAmount = 0;
  const lineTotals = data.items.map((item) => {
    const lineTotal = item.costPrice * item.qty;
    totalAmount += lineTotal;
    return lineTotal;
  });

  const purchaseNumber = await nextDocumentNumber("PURCHASE", "PO-");

  const purchase = unwrap(
    await db
      .from("purchases")
      .insert({
        purchase_number: purchaseNumber,
        supplier_id: data.supplierId ?? null,
        total_amount: totalAmount,
        created_by_id: actor.id,
      } as any)
      .select("*")
      .single()
  );

  const itemsToInsert = data.items.map((item, i) => ({
    purchase_id: purchase.id,
    product_id: item.productId,
    warehouse_id: item.warehouseId,
    qty: item.qty,
    damaged_qty: item.damagedQty,
    cost_price: item.costPrice,
    line_total: lineTotals[i],
  }));
  const createdItems = unwrap(await db.from("purchase_items").insert(itemsToInsert as any).select("*"));

  for (const item of data.items) {
    const existing = unwrap(
      await db
        .from("stock")
        .select("*")
        .eq("product_id", item.productId)
        .eq("warehouse_id", item.warehouseId)
        .maybeSingle()
    );
    const previousQty = existing?.quantity ?? 0;
    const newQty = previousQty + item.qty;
    const previousDamagedQty = existing?.damaged_quantity ?? 0;
    const previousDamagedTransitQty = existing?.damaged_quantity_transit ?? 0;
    const newDamagedQty = previousDamagedQty + item.damagedQty;
    const newDamagedTransitQty = previousDamagedTransitQty + item.damagedQty;

    if (existing) {
      unwrap(
        await db
          .from("stock")
          .update({
            quantity: newQty,
            damaged_quantity: newDamagedQty,
            damaged_quantity_transit: newDamagedTransitQty,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", existing.id)
          .select("*")
          .single()
      );
    } else {
      unwrap(
        await db
          .from("stock")
          .insert({
            product_id: item.productId,
            warehouse_id: item.warehouseId,
            quantity: newQty,
            damaged_quantity: newDamagedQty,
            damaged_quantity_transit: newDamagedTransitQty,
            reorder_level: 0,
            updated_at: new Date().toISOString(),
          } as any)
          .select("*")
          .single()
      );
    }

    unwrap(
      await db.from("stock_ledger").insert({
        product_id: item.productId,
        warehouse_id: item.warehouseId,
        change_qty: item.qty,
        previous_qty: previousQty,
        balance_qty: newQty,
        reference_type: "purchase",
        reference_id: purchase.id,
        performed_by_id: actor.id,
        ...(item.damagedQty > 0 ? { reason: `${item.damagedQty} unit(s) received damaged (transit)` } : {}),
      } as any)
    );
  }

  await recordAudit({
    userId: actor.id,
    action: "STOCK_IN",
    entityType: "Purchase",
    entityId: purchase.id,
    metadata: {
      purchaseNumber: purchase.purchase_number,
      totalAmount: String(totalAmount),
      items: data.items.map((i) => ({
        productId: i.productId,
        productName: productMap.get(i.productId)?.name,
        warehouseId: i.warehouseId,
        warehouseName: undefined,
        qty: i.qty,
        damagedQty: i.damagedQty,
      })),
    },
  });

  return getPurchaseById(purchase.id);
}

async function getPurchaseById(id: number) {
  const purchase = unwrap(await db.from("purchases").select("*").eq("id", id).maybeSingle());
  if (!purchase) throw new ApiError(404, "Purchase not found");
  return hydratePurchases([purchase])[0];
}

async function hydratePurchases(purchases: any[]) {
  if (purchases.length === 0) return [];
  const purchaseIds = purchases.map((p) => p.id);
  const supplierIds = [...new Set(purchases.map((p) => p.supplier_id).filter((x) => x != null))];

  const [items, suppliers] = await Promise.all([
    unwrap(
      await db
        .from("purchase_items")
        .select("*, product:products(*), warehouse:warehouses(*)")
        .in("purchase_id", purchaseIds)
    ),
    supplierIds.length ? unwrap(await db.from("suppliers").select("*").in("id", supplierIds)) : Promise.resolve([]),
  ]);

  const supplierMap = new Map((suppliers as any[]).map((s: any) => [s.id, s]));
  const itemsByPurchase = new Map<number, any[]>();
  for (const item of items as any[]) {
    const list = itemsByPurchase.get(item.purchase_id) ?? [];
    list.push(item);
    itemsByPurchase.set(item.purchase_id, list);
  }

  return purchases.map((p) =>
    toCamel({
      ...p,
      items: itemsByPurchase.get(p.id) ?? [],
      supplier: p.supplier_id ? supplierMap.get(p.supplier_id) ?? null : null,
    })
  );
}

async function listPurchases(ctx: Ctx) {
  requireUser(ctx);
  const purchases = unwrap(
    await db.from("purchases").select("*").order("created_at", { ascending: false }).limit(200)
  );
  return hydratePurchases(purchases as any[]);
}

async function getPurchase(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params.id);
  return getPurchaseById(id);
}

const createSupplierReturnSchema = z.object({
  warehouseId: z.number().int(),
  supplierId: z.number().int().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        qty: z.number().int().positive(),
      })
    )
    .min(1, "Supplier return must contain at least one item"),
});

async function createSupplierReturn(ctx: Ctx) {
  const actor = requireUser(ctx);
  const data = createSupplierReturnSchema.parse(ctx.body);

  const productIds = data.items.map((i) => i.productId);
  const stockRows = unwrap(
    await db
      .from("stock")
      .select("*, product:products(*)")
      .eq("warehouse_id", data.warehouseId)
      .in("product_id", productIds)
  );
  const stockMap = new Map((stockRows as any[]).map((s: any) => [s.product_id, s]));

  for (const item of data.items) {
    const stock = stockMap.get(item.productId);
    if (!stock || stock.damaged_quantity < item.qty) {
      const name = stock?.product?.name ?? `product ${item.productId}`;
      throw new ApiError(
        400,
        `Cannot return ${item.qty} of "${name}" to supplier — only ${stock?.damaged_quantity ?? 0} marked damaged at this warehouse`
      );
    }
  }

  const returnNumber = await nextDocumentNumber("SUPPLIER_RETURN", "SR-");
  const warehouse = unwrap(await db.from("warehouses").select("*").eq("id", data.warehouseId).maybeSingle());
  if (!warehouse) throw new ApiError(400, `Warehouse ${data.warehouseId} not found`);

  const created = unwrap(
    await db
      .from("supplier_returns")
      .insert({
        return_number: returnNumber,
        supplier_id: data.supplierId ?? null,
        warehouse_id: data.warehouseId,
        created_by_id: actor.id,
      } as any)
      .select("*")
      .single()
  );

  const itemsToInsert = data.items.map((i) => ({
    supplier_return_id: created.id,
    product_id: i.productId,
    qty: i.qty,
  }));
  unwrap(await db.from("supplier_return_items").insert(itemsToInsert as any).select("*"));

  for (const item of data.items) {
    const stock = stockMap.get(item.productId)!;
    const newDamagedQuantityTransit = Math.max(0, stock.damaged_quantity_transit - item.qty);
    unwrap(
      await db
        .from("stock")
        .update({
          damaged_quantity: stock.damaged_quantity - item.qty,
          damaged_quantity_transit: newDamagedQuantityTransit,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", stock.id)
        .select("*")
        .single()
    );
  }

  await recordAudit({
    userId: actor.id,
    action: "SUPPLIER_RETURN",
    entityType: "SupplierReturn",
    entityId: created.id,
    metadata: {
      returnNumber: created.return_number,
      warehouseId: data.warehouseId,
      warehouseName: warehouse.name,
      items: data.items.map((i) => ({
        productId: i.productId,
        productName: stockMap.get(i.productId)?.product?.name,
        qty: i.qty,
      })),
    },
  });

  return getSupplierReturnById(created.id);
}

async function getSupplierReturnById(id: number) {
  const supplierReturn = unwrap(await db.from("supplier_returns").select("*").eq("id", id).maybeSingle());
  if (!supplierReturn) throw new ApiError(404, "Supplier return not found");
  return hydrateSupplierReturns([supplierReturn])[0];
}

async function hydrateSupplierReturns(returns: any[]) {
  if (returns.length === 0) return [];
  const returnIds = returns.map((r) => r.id);
  const supplierIds = [...new Set(returns.map((r) => r.supplier_id).filter((x) => x != null))];
  const warehouseIds = [...new Set(returns.map((r) => r.warehouse_id))];

  const [items, suppliers, warehouses] = await Promise.all([
    unwrap(await db.from("supplier_return_items").select("*, product:products(*)").in("supplier_return_id", returnIds)),
    supplierIds.length ? unwrap(await db.from("suppliers").select("*").in("id", supplierIds)) : Promise.resolve([]),
    unwrap(await db.from("warehouses").select("*").in("id", warehouseIds)),
  ]);

  const supplierMap = new Map((suppliers as any[]).map((s: any) => [s.id, s]));
  const warehouseMap = new Map((warehouses as any[]).map((w: any) => [w.id, w]));
  const itemsByReturn = new Map<number, any[]>();
  for (const item of items as any[]) {
    const list = itemsByReturn.get(item.supplier_return_id) ?? [];
    list.push(item);
    itemsByReturn.set(item.supplier_return_id, list);
  }

  return returns.map((r) =>
    toCamel({
      ...r,
      items: itemsByReturn.get(r.id) ?? [],
      supplier: r.supplier_id ? supplierMap.get(r.supplier_id) ?? null : null,
      warehouse: warehouseMap.get(r.warehouse_id) ?? null,
    })
  );
}

async function listSupplierReturns(ctx: Ctx) {
  requireUser(ctx);
  const returns = unwrap(
    await db.from("supplier_returns").select("*").order("created_at", { ascending: false }).limit(200)
  );
  return hydrateSupplierReturns(returns as any[]);
}

async function getSupplierReturn(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params.id);
  return getSupplierReturnById(id);
}

export const purchaseRoutes: RouteDef[] = [
  { method: "POST", path: "purchases", handler: createPurchase },
  { method: "GET", path: "purchases", handler: listPurchases },
  { method: "GET", path: "purchases/:id", handler: getPurchase },
  { method: "POST", path: "supplier-returns", handler: createSupplierReturn },
  { method: "GET", path: "supplier-returns", handler: listSupplierReturns },
  { method: "GET", path: "supplier-returns/:id", handler: getSupplierReturn },
];
