import { z } from "zod";

import { ApiError, db, num, recordAudit, requireUser, toCamel, type Ctx, type RouteDef } from "./core.server";

const MAX_IMAGE_BYTES = 50 * 1024;

function base64ByteSize(dataUri: string): number {
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  return Math.ceil((base64.length * 3) / 4);
}

const imageDataSchema = z
  .string()
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/, "Image must be a JPEG, PNG, or WebP data URI")
  .refine((val) => base64ByteSize(val) <= MAX_IMAGE_BYTES, `Image must be ${MAX_IMAGE_BYTES / 1024}KB or smaller`)
  .optional()
  .or(z.literal(""));

// If this barcode was previously minted via the Barcode Generator pool
// (still sitting there as 'unused'), mark it claimed by the product that
// just took it. A barcode never has to come from the pool — a
// manufacturer's own barcode just isn't found here, and that's fine, no-op.
async function claimGeneratedBarcode(barcode: string, productId: number): Promise<void> {
  const { data: pooled } = await db.from("generated_barcodes").select("*").eq("code", barcode).maybeSingle();
  if (pooled && pooled.status === "unused") {
    await db
      .from("generated_barcodes")
      .update({ status: "assigned", assigned_product_id: productId, assigned_at: new Date().toISOString() })
      .eq("id", pooled.id);
  }
}

async function lookupByBarcode(ctx: Ctx) {
  requireUser(ctx);
  const barcode = String(ctx.query.get("barcode") ?? "").trim();
  if (!barcode) throw new ApiError(400, "barcode query param is required");

  const { data: product } = await db.from("products").select("*").eq("barcode", barcode).maybeSingle();
  if (!product || !product.is_active) {
    throw new ApiError(404, "Product not found for this barcode");
  }

  const { data: stock } = await db
    .from("stock")
    .select("*, warehouses(*)")
    .eq("product_id", product.id);

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    category: product.category,
    brand: product.brand,
    mrp: product.mrp,
    sellingPrice: product.selling_price,
    taxPercent: product.tax_percent,
    imageUrl: product.image_url,
    imageData: product.image_data,
    unit: product.unit,
    stockByWarehouse: (stock ?? []).map((s: any) => ({
      warehouseId: s.warehouse_id,
      warehouseName: s.warehouses.name,
      location: s.warehouses.location,
      quantity: s.quantity,
      reorderLevel: s.reorder_level,
      lowStock: s.quantity <= s.reorder_level,
    })),
  };
}

async function getProductStock(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params.id);
  const { data: stock } = await db
    .from("stock")
    .select("*, warehouses(*)")
    .eq("product_id", id);

  if (!stock || stock.length === 0) {
    const { data: exists } = await db.from("products").select("id").eq("id", id).maybeSingle();
    if (!exists) throw new ApiError(404, "Product not found");
  }

  return (stock ?? []).map((s: any) => ({
    warehouseId: s.warehouse_id,
    warehouseName: s.warehouses.name,
    quantity: s.quantity,
    damagedQuantity: s.damaged_quantity,
    reorderLevel: s.reorder_level,
    lowStock: s.quantity <= s.reorder_level,
  }));
}

async function listProducts(ctx: Ctx) {
  requireUser(ctx);
  const search = String(ctx.query.get("search") ?? "").trim();
  const includeInactive = ctx.query.get("includeInactive") === "true";

  let queryBuilder = db.from("products").select("*");
  if (!includeInactive) queryBuilder = queryBuilder.eq("is_active", true);
  if (search) {
    const term = search.replace(/[%,]/g, "");
    queryBuilder = queryBuilder.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`);
  }
  const { data: products, error } = await queryBuilder.order("created_at", { ascending: false }).limit(100);
  if (error) throw new ApiError(400, error.message);

  return toCamel(products ?? []);
}

const resolveCodesSchema = z.object({
  codes: z.array(z.string().trim().min(1)).min(1).max(1000),
});

// Matches each code (as typed in a restock spreadsheet) against an existing
// product's barcode or SKU — used by the Purchases bulk-import flow, which
// must only ever restock products that already exist, never create new
// ones. `limit(100)` on listProducts makes it unusable for this; codes can
// come in any order or duplicate the same product, so lookup is by exact
// code rather than pagination.
async function resolveProductCodes(ctx: Ctx) {
  requireUser(ctx);
  const { codes } = resolveCodesSchema.parse(ctx.body);
  const uniqueCodes = [...new Set(codes)];

  const { data: products, error } = await db
    .from("products")
    .select("*")
    .eq("is_active", true)
    .or(`barcode.in.(${uniqueCodes.map((c) => `"${c}"`).join(",")}),sku.in.(${uniqueCodes.map((c) => `"${c}"`).join(",")})`);
  if (error) throw new ApiError(400, error.message);

  const byBarcode = new Map((products ?? []).map((p: any) => [p.barcode, p]));
  const bySku = new Map((products ?? []).map((p: any) => [p.sku, p]));

  return {
    results: codes.map((code) => ({
      code,
      product: toCamel(byBarcode.get(code) ?? bySku.get(code) ?? null),
    })),
  };
}

const createProductSchema = z.object({
  name: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().min(1),
  category: z.string().optional(),
  brand: z.string().optional(),
  mrp: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  taxPercent: z.number().min(0).max(100).default(0),
  imageUrl: z.string().url().optional().or(z.literal("")),
  imageData: imageDataSchema,
  unit: z.string().default("pcs"),
  initialStock: z
    .array(
      z.object({
        warehouseId: z.number().int(),
        quantity: z.number().int().nonnegative(),
        reorderLevel: z.number().int().nonnegative().default(0),
      })
    )
    .optional(),
});

async function createProduct(ctx: Ctx) {
  const actor = requireUser(ctx);
  const data = createProductSchema.parse(ctx.body);

  const { data: existing } = await db.from("products").select("id").eq("barcode", data.barcode).maybeSingle();
  if (existing) throw new ApiError(409, "A product with this barcode already exists");

  const now = new Date().toISOString();
  const { data: created, error } = await db
    .from("products")
    .insert({
      name: data.name,
      sku: data.sku,
      barcode: data.barcode,
      category: data.category ?? null,
      brand: data.brand ?? null,
      mrp: data.mrp,
      selling_price: data.sellingPrice,
      tax_percent: data.taxPercent,
      image_url: data.imageUrl || null,
      image_data: data.imageData || null,
      unit: data.unit,
      updated_at: now,
    } as any)
    .select("*")
    .single();
  if (error) throw new ApiError(400, error.message);

  if (data.initialStock?.length) {
    const { error: stockError } = await db.from("stock").insert(
      data.initialStock.map((s) => ({
        product_id: created.id,
        warehouse_id: s.warehouseId,
        quantity: s.quantity,
        reorder_level: s.reorderLevel,
        updated_at: now,
      })) as any
    );
    if (stockError) throw new ApiError(400, stockError.message);
  }

  await claimGeneratedBarcode(created.barcode, created.id);

  await recordAudit({
    userId: actor.id,
    action: "PRODUCT_CREATED",
    entityType: "Product",
    entityId: created.id,
    metadata: { name: created.name, sku: created.sku, barcode: created.barcode },
  });

  return toCamel(created);
}

const bulkProductRowSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().min(1),
  category: z.string().optional(),
  brand: z.string().optional(),
  mrp: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  taxPercent: z.number().min(0).max(100).default(0),
  imageUrl: z.string().url().optional().or(z.literal("")),
  imageData: imageDataSchema,
  unit: z.string().default("pcs"),
  initialStock: z.array(z.object({ warehouseId: z.number().int(), quantity: z.number().int().nonnegative() })).optional(),
});

const bulkProductsSchema = z.object({
  products: z.array(bulkProductRowSchema).min(1, "Add at least one product row"),
});

async function createProductsBulk(ctx: Ctx) {
  const actor = requireUser(ctx);
  const data = bulkProductsSchema.parse(ctx.body);

  const { count: existingCount } = await db.from("products").select("*", { count: "exact", head: true });
  let nextSkuSeq = num(existingCount) + 1;

  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();
  const results: Array<{ index: number; success: true; product: any } | { index: number; success: false; error: string }> = [];

  const now = new Date().toISOString();

  for (let i = 0; i < data.products.length; i++) {
    const item = data.products[i];
    try {
      if (seenBarcodes.has(item.barcode)) {
        throw new Error(`Duplicate barcode "${item.barcode}" within this batch`);
      }
      const { data: existingBarcode } = await db.from("products").select("id").eq("barcode", item.barcode).maybeSingle();
      if (existingBarcode) {
        throw new Error(`Barcode "${item.barcode}" already exists`);
      }
      seenBarcodes.add(item.barcode);

      let sku = item.sku?.trim();
      if (sku) {
        if (seenSkus.has(sku)) throw new Error(`Duplicate SKU "${sku}" within this batch`);
        const { data: existingSku } = await db.from("products").select("id").eq("sku", sku).maybeSingle();
        if (existingSku) throw new Error(`SKU "${sku}" already exists`);
      } else {
        do {
          sku = `SKU-${String(nextSkuSeq).padStart(4, "0")}`;
          nextSkuSeq++;
        } while (seenSkus.has(sku));
      }
      seenSkus.add(sku);

      const { data: created, error } = await db
        .from("products")
        .insert({
          name: item.name,
          sku: sku!,
          barcode: item.barcode,
          category: item.category ?? null,
          brand: item.brand ?? null,
          mrp: item.mrp,
          selling_price: item.sellingPrice,
          tax_percent: item.taxPercent,
          image_url: item.imageUrl || null,
          image_data: item.imageData || null,
          unit: item.unit,
          updated_at: now,
        } as any)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      if (item.initialStock?.length) {
        const { error: stockError } = await db.from("stock").insert(
          item.initialStock.map((s) => ({
            product_id: created.id,
            warehouse_id: s.warehouseId,
            quantity: s.quantity,
            reorder_level: 0,
            updated_at: now,
          })) as any
        );
        if (stockError) throw new Error(stockError.message);
      }

      await claimGeneratedBarcode(created.barcode, created.id);

      results.push({ index: i, success: true, product: toCamel(created) });
    } catch (err) {
      results.push({ index: i, success: false, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  const succeeded = results.filter((r) => r.success);
  if (succeeded.length > 0) {
    await recordAudit({
      userId: actor.id,
      action: "PRODUCT_CREATED",
      entityType: "Product",
      metadata: { bulk: true, count: succeeded.length },
    });
  }

  return { results };
}

const updateProductSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  mrp: z.number().nonnegative().optional(),
  sellingPrice: z.number().nonnegative().optional(),
  taxPercent: z.number().min(0).max(100).optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  imageData: imageDataSchema,
  unit: z.string().optional(),
  isActive: z.boolean().optional(),
});

async function updateProduct(ctx: Ctx) {
  const actor = requireUser(ctx);
  const id = Number(ctx.params.id);
  const data = updateProductSchema.parse(ctx.body);

  const { data: existing } = await db.from("products").select("*").eq("id", id).maybeSingle();
  if (!existing) throw new ApiError(404, "Product not found");

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.category !== undefined) updates.category = data.category;
  if (data.brand !== undefined) updates.brand = data.brand;
  if (data.mrp !== undefined) updates.mrp = data.mrp;
  if (data.sellingPrice !== undefined) updates.selling_price = data.sellingPrice;
  if (data.taxPercent !== undefined) updates.tax_percent = data.taxPercent;
  if (data.unit !== undefined) updates.unit = data.unit;
  if (data.isActive !== undefined) updates.is_active = data.isActive;
  if (data.imageUrl !== undefined) updates.image_url = data.imageUrl || null;
  if (data.imageData !== undefined) updates.image_data = data.imageData || null;

  const { data: updated, error } = await db.from("products").update(updates as any).eq("id", id).select("*").single();
  if (error) throw new ApiError(400, error.message);

  if (data.isActive !== undefined && data.isActive !== existing.is_active) {
    await recordAudit({
      userId: actor.id,
      action: data.isActive ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
      entityType: "Product",
      entityId: id,
      metadata: { name: updated.name, sku: updated.sku },
    });
  } else {
    await recordAudit({
      userId: actor.id,
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: id,
      metadata: { name: updated.name, sku: updated.sku, changes: Object.keys(data) },
    });
  }

  return toCamel(updated);
}

export const productRoutes: RouteDef[] = [
  { method: "GET", path: "products/lookup", handler: lookupByBarcode },
  { method: "GET", path: "products/:id/stock", handler: getProductStock },
  { method: "GET", path: "products", handler: listProducts },
  { method: "POST", path: "products", handler: createProduct },
  { method: "POST", path: "products/bulk", handler: createProductsBulk },
  { method: "POST", path: "products/resolve-codes", handler: resolveProductCodes },
  { method: "PUT", path: "products/:id", handler: updateProduct },
];
