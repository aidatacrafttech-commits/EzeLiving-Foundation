// Catalog & admin/reporting routes ported from the original Express/Prisma backend.
import bcrypt from "bcryptjs";
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
/* Warehouses                                                          */
/* ------------------------------------------------------------------ */

async function listWarehouses(ctx: Ctx) {
  requireUser(ctx);
  const res = await db.from("warehouses").select("*").eq("is_active", true).order("name", { ascending: true });
  return toCamel(unwrap(res));
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

async function listCustomers(ctx: Ctx) {
  requireUser(ctx);
  const search = (ctx.query.get("search") ?? "").trim();
  let query = db.from("customers").select("*").order("id", { ascending: false }).limit(50);
  if (search) {
    const escaped = search.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`);
  }
  const res = await query;
  return toCamel(unwrap(res));
}

async function getCustomer(ctx: Ctx) {
  requireUser(ctx);
  const id = Number(ctx.params.id);
  const { data: customer } = await db.from("customers").select("*").eq("id", id).maybeSingle();
  if (!customer) throw new ApiError(404, "Customer not found");
  return toCamel(customer);
}

const createCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  gstNumber: z.string().optional(),
  address: z.string().optional(),
});

async function createCustomer(ctx: Ctx) {
  requireUser(ctx);
  const data = createCustomerSchema.parse(ctx.body);
  const phone = data.phone?.trim() || null;

  const fields: Record<string, unknown> = {
    name: data.name,
    ...(data.email ? { email: data.email } : {}),
    ...(data.gstNumber ? { gst_number: data.gstNumber } : {}),
    ...(data.address ? { address: data.address } : {}),
  };
  const now = new Date().toISOString();

  if (phone) {
    const { data: existing } = await db.from("customers").select("id").eq("phone", phone).maybeSingle();
    if (existing) {
      const res = await db
        .from("customers")
        .update({ ...fields, updated_at: now })
        .eq("id", existing.id)
        .select("*")
        .single();
      return toCamel(unwrap(res));
    }
    const res = await db
      .from("customers")
      .insert({ ...fields, phone, updated_at: now } as never)
      .select("*")
      .single();
    return toCamel(unwrap(res));
  }

  const res = await db
    .from("customers")
    .insert({ ...fields, updated_at: now } as never)
    .select("*")
    .single();
  return toCamel(unwrap(res));
}

/* ------------------------------------------------------------------ */
/* Suppliers                                                            */
/* ------------------------------------------------------------------ */

async function listSuppliers(ctx: Ctx) {
  requireUser(ctx);
  const search = (ctx.query.get("search") ?? "").trim();
  let query = db.from("suppliers").select("*").order("id", { ascending: false }).limit(50);
  if (search) {
    const escaped = search.replace(/[%_]/g, (c) => `\\${c}`);
    query = query.or(`name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`);
  }
  const res = await query;
  return toCamel(unwrap(res));
}

const createSupplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
});

async function createSupplier(ctx: Ctx) {
  requireUser(ctx);
  const data = createSupplierSchema.parse(ctx.body);
  const res = await db
    .from("suppliers")
    .insert({
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
    })
    .select("*")
    .single();
  return toCamel(unwrap(res));
}

/* ------------------------------------------------------------------ */
/* Coupons                                                              */
/* ------------------------------------------------------------------ */

async function listCoupons(ctx: Ctx) {
  requireUser(ctx);
  const res = await db.from("coupons").select("*").order("created_at", { ascending: false });
  return toCamel(unwrap(res));
}

async function validateCoupon(ctx: Ctx) {
  requireUser(ctx);
  const code = (ctx.query.get("code") ?? "").trim();
  if (!code) throw new ApiError(400, "code query param is required");

  const { data: coupon } = await db
    .from("coupons")
    .select("*")
    .ilike("code", code)
    .eq("is_active", true)
    .maybeSingle();
  if (!coupon) throw new ApiError(404, "Invalid or inactive coupon code");

  return { code: coupon.code, discountPercent: Number(coupon.discount_percent) };
}

const createCouponSchema = z.object({
  code: z.string().trim().min(1),
  discountPercent: z.number().positive().max(100),
});

async function createCoupon(ctx: Ctx) {
  requireAdmin(ctx);
  const data = createCouponSchema.parse(ctx.body);

  const { data: existing } = await db.from("coupons").select("id").ilike("code", data.code).maybeSingle();
  if (existing) throw new ApiError(409, "A coupon with this code already exists");

  const res = await db
    .from("coupons")
    .insert({ code: data.code, discount_percent: data.discountPercent })
    .select("*")
    .single();
  return toCamel(unwrap(res));
}

const updateCouponSchema = z.object({
  discountPercent: z.number().positive().max(100).optional(),
  isActive: z.boolean().optional(),
});

async function updateCoupon(ctx: Ctx) {
  requireAdmin(ctx);
  const id = Number(ctx.params.id);
  const data = updateCouponSchema.parse(ctx.body);

  const { data: existing } = await db.from("coupons").select("id").eq("id", id).maybeSingle();
  if (!existing) throw new ApiError(404, "Coupon not found");

  const res = await db
    .from("coupons")
    .update({
      ...(data.discountPercent !== undefined ? { discount_percent: data.discountPercent } : {}),
      ...(data.isActive !== undefined ? { is_active: data.isActive } : {}),
    })
    .eq("id", id)
    .select("*")
    .single();
  return toCamel(unwrap(res));
}

/* ------------------------------------------------------------------ */
/* Audit logs                                                          */
/* ------------------------------------------------------------------ */

async function listAuditLogs(ctx: Ctx) {
  requireAdmin(ctx);
  const userId = ctx.query.get("userId");
  const action = ctx.query.get("action");
  const entityType = ctx.query.get("entityType");
  const entityId = ctx.query.get("entityId");
  const from = ctx.query.get("from");
  const to = ctx.query.get("to");

  let query = db
    .from("audit_logs")
    .select("*, user:users(id, name, email, role)")
    .order("created_at", { ascending: false })
    .limit(300);

  if (userId) query = query.eq("user_id", Number(userId));
  if (action) query = query.eq("action", action);
  if (entityType) query = query.eq("entity_type", entityType);
  if (entityId) query = query.eq("entity_id", Number(entityId));
  if (from) query = query.gte("created_at", new Date(from).toISOString());
  if (to) query = query.lte("created_at", new Date(to).toISOString());

  const res = await query;
  return toCamel(unwrap(res));
}

/* ------------------------------------------------------------------ */
/* Users                                                                */
/* ------------------------------------------------------------------ */

const userSummaryColumns = "id, name, email, role, is_active, created_at, updated_at, last_login_at";

async function listUsers(ctx: Ctx) {
  requireAdmin(ctx);
  const res = await db.from("users").select(userSummaryColumns).order("created_at", { ascending: false });
  return toCamel(unwrap(res));
}

async function getUser(ctx: Ctx) {
  requireAdmin(ctx);
  const id = Number(ctx.params.id);
  const { data: user } = await db.from("users").select(userSummaryColumns).eq("id", id).maybeSingle();
  if (!user) throw new ApiError(404, "User not found");

  const activityRes = await db
    .from("audit_logs")
    .select("*")
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .limit(100);

  return { user: toCamel(user), activity: toCamel(unwrap(activityRes)) };
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

async function createUser(ctx: Ctx) {
  const actor = requireAdmin(ctx);
  const data = createUserSchema.parse(ctx.body);
  const email = data.email.toLowerCase();

  const { data: existing } = await db.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) throw new ApiError(409, "A user with this email already exists");

  const passwordHash = await bcrypt.hash(data.password, 10);
  const now = new Date().toISOString();

  const res = await db
    .from("users")
    .insert({
      name: data.name,
      email,
      password_hash: passwordHash,
      role: "staff",
      created_at: now,
      updated_at: now,
    })
    .select(userSummaryColumns)
    .single();
  const created = unwrap(res);

  await recordAudit({
    userId: actor.id,
    action: "STAFF_CREATED",
    entityType: "User",
    entityId: created.id,
    metadata: { name: created.name, email: created.email },
  });

  return toCamel(created);
}

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["admin", "staff"]).optional(),
  isActive: z.boolean().optional(),
});

async function updateUser(ctx: Ctx) {
  const actor = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  const data = updateUserSchema.parse(ctx.body);

  const { data: existing } = await db.from("users").select("*").eq("id", id).maybeSingle();
  if (!existing) throw new ApiError(404, "User not found");

  if (actor.id === id) {
    if (data.isActive === false) throw new ApiError(400, "You cannot deactivate your own account");
    if (data.role === "staff") throw new ApiError(400, "You cannot remove your own admin role");
  }

  const email = data.email?.toLowerCase();
  if (email && email !== existing.email) {
    const { data: emailTaken } = await db.from("users").select("id").eq("email", email).maybeSingle();
    if (emailTaken) throw new ApiError(409, "A user with this email already exists");
  }

  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(data.role !== undefined ? { role: data.role } : {}),
    ...(data.isActive !== undefined ? { is_active: data.isActive } : {}),
    ...(data.password !== undefined ? { password_hash: await bcrypt.hash(data.password, 10) } : {}),
  };

  const res = await db.from("users").update(updateFields as never).eq("id", id).select(userSummaryColumns).single();
  const updated = unwrap(res);

  if (data.isActive !== undefined && data.isActive !== existing.is_active) {
    await recordAudit({
      userId: actor.id,
      action: data.isActive ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED",
      entityType: "User",
      entityId: id,
      metadata: { name: updated.name, email: updated.email },
    });
  } else {
    await recordAudit({
      userId: actor.id,
      action: "STAFF_UPDATED",
      entityType: "User",
      entityId: id,
      metadata: { name: updated.name, email: updated.email, changes: Object.keys(data) },
    });
  }

  return toCamel(updated);
}

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function getSalesSummary(ctx: Ctx) {
  requireUser(ctx);
  const today = startOfToday().toISOString();
  const monthStart = startOfMonth().toISOString();

  const [todayRes, monthRes, warehousesRes] = await Promise.all([
    db.from("invoices").select("grand_total").neq("status", "cancelled").gte("created_at", today),
    db.from("invoices").select("grand_total").neq("status", "cancelled").gte("created_at", monthStart),
    db.from("warehouses").select("*"),
  ]);

  const todayRows = unwrap(todayRes);
  const monthRows = unwrap(monthRes);
  const warehouses = unwrap(warehousesRes);
  const warehouseMap = new Map(warehouses.map((w: any) => [w.id, w]));

  const todaySum = todayRows.reduce((acc: number, r: any) => acc + Number(r.grand_total ?? 0), 0);
  const monthSum = monthRows.reduce((acc: number, r: any) => acc + Number(r.grand_total ?? 0), 0);

  // Month invoices with warehouse + id, for grouping and top items.
  const monthInvoicesRes = await db
    .from("invoices")
    .select("id, warehouse_id, grand_total")
    .neq("status", "cancelled")
    .gte("created_at", monthStart);
  const monthInvoices = unwrap(monthInvoicesRes);
  const monthInvoiceIds = monthInvoices.map((i: any) => i.id);

  const salesByWarehouseMap = new Map<number, number>();
  for (const inv of monthInvoices) {
    const key = inv.warehouse_id as number;
    salesByWarehouseMap.set(key, (salesByWarehouseMap.get(key) ?? 0) + Number(inv.grand_total ?? 0));
  }

  let topItems: { productId: number; qty: number }[] = [];
  if (monthInvoiceIds.length > 0) {
    const itemsRes = await db.from("invoice_items").select("product_id, qty").in("invoice_id", monthInvoiceIds);
    const items = unwrap(itemsRes);
    const qtyMap = new Map<number, number>();
    for (const item of items) {
      qtyMap.set(item.product_id, (qtyMap.get(item.product_id) ?? 0) + Number(item.qty ?? 0));
    }
    topItems = [...qtyMap.entries()]
      .map(([productId, qty]) => ({ productId, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }

  const productIds = topItems.map((i) => i.productId);
  let productMap = new Map<number, any>();
  if (productIds.length > 0) {
    const productsRes = await db.from("products").select("id, name, sku").in("id", productIds);
    const products = unwrap(productsRes);
    productMap = new Map(products.map((p: any) => [p.id, p]));
  }

  return {
    today: { totalSales: todaySum, invoiceCount: todayRows.length },
    thisMonth: { totalSales: monthSum, invoiceCount: monthRows.length },
    topProducts: topItems.map((i) => ({
      productId: i.productId,
      productName: productMap.get(i.productId)?.name ?? "Unknown",
      sku: productMap.get(i.productId)?.sku ?? "",
      qtySold: i.qty,
    })),
    salesByWarehouse: [...salesByWarehouseMap.entries()].map(([warehouseId, totalSales]) => ({
      warehouseId,
      warehouseName: (warehouseMap.get(warehouseId) as any)?.name ?? "Unknown",
      totalSales,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Generated barcodes                                                   */
/* ------------------------------------------------------------------ */

const MAX_BATCH = 500;

const generateSchema = z.object({
  count: z.number().int().min(1).max(MAX_BATCH),
  material: z.enum(["MB", "GL", "OT"]).optional(),
});

async function generateBarcodeNumber(material?: "MB" | "GL" | "OT"): Promise<string> {
  const prefix = material ? `${material}-EZE-` : "EZE-";
  return nextDocumentNumber("BARCODE", prefix);
}

async function generateBarcodes(ctx: Ctx) {
  const actor = requireUser(ctx);
  const { count, material } = generateSchema.parse(ctx.body);

  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = await generateBarcodeNumber(material);
    await db.from("generated_barcodes").insert({ code, created_by_id: actor.id } as any);
    codes.push(code);
  }

  return codes;
}

const listQuerySchema = z.object({
  status: z.enum(["unused", "assigned"]).optional(),
});

async function listGeneratedBarcodes(ctx: Ctx) {
  requireUser(ctx);
  const { status } = listQuerySchema.parse({ status: ctx.query.get("status") || undefined });

  let query = db
    .from("generated_barcodes")
    .select("*, assigned_product:products(id, name, sku)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);

  const res = await query;
  return toCamel(unwrap(res));
}

export const catalogRoutes: RouteDef[] = [
  { method: "GET", path: "warehouses", handler: listWarehouses },

  { method: "GET", path: "customers", handler: listCustomers },
  { method: "GET", path: "customers/:id", handler: getCustomer },
  { method: "POST", path: "customers", handler: createCustomer },

  { method: "GET", path: "suppliers", handler: listSuppliers },
  { method: "POST", path: "suppliers", handler: createSupplier },

  { method: "GET", path: "coupons", handler: listCoupons },
  { method: "GET", path: "coupons/validate", handler: validateCoupon },
  { method: "POST", path: "coupons", handler: createCoupon },
  { method: "PUT", path: "coupons/:id", handler: updateCoupon },

  { method: "GET", path: "audit-logs", handler: listAuditLogs },

  { method: "GET", path: "users", handler: listUsers },
  { method: "GET", path: "users/:id", handler: getUser },
  { method: "POST", path: "users", handler: createUser },
  { method: "PUT", path: "users/:id", handler: updateUser },

  { method: "GET", path: "reports/summary", handler: getSalesSummary },

  { method: "GET", path: "barcodes", handler: listGeneratedBarcodes },
  { method: "POST", path: "barcodes/generate", handler: generateBarcodes },
];
