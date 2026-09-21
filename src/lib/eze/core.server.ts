// Shared helpers for the EzeLiving API running on Lovable Cloud.
// Mirrors the behaviour of the original Express/Prisma backend.
import { SignJWT, jwtVerify } from "jose";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const db = supabaseAdmin;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Role = "admin" | "staff";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
}

export interface Ctx {
  user: AuthUser | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  request: Request;
}

/* ------------------------------------------------------------------ */
/* Case conversion: DB is snake_case, the existing UI expects camelCase */
/* ------------------------------------------------------------------ */

function camel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function toCamel<T = any>(value: any): T {
  if (Array.isArray(value)) return value.map((v) => toCamel(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[camel(k)] = toCamel(v);
    return out as T;
  }
  return value as T;
}

export function toSnake<T = any>(value: any): T {
  if (Array.isArray(value)) return value.map((v) => toSnake(v)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[snake(k)] = v;
    return out as T;
  }
  return value as T;
}

/** Unwraps a supabase-js result, throwing an ApiError on failure. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new ApiError(400, res.error.message);
  return res.data as T;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

function secret(): Uint8Array {
  const value = process.env["JWT_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!value) throw new ApiError(500, "Server auth is not configured");
  return new TextEncoder().encode(value);
}

export async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({ id: user.id, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
}

export async function readUser(request: Request): Promise<AuthUser | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(header.slice(7), secret());
    return { id: Number(payload["id"]), email: String(payload["email"]), role: payload["role"] as Role };
  } catch {
    return null;
  }
}

export function requireUser(ctx: Ctx): AuthUser {
  if (!ctx.user) throw new ApiError(401, "Missing or invalid Authorization header");
  return ctx.user;
}

export function requireAdmin(ctx: Ctx): AuthUser {
  const user = requireUser(ctx);
  if (user.role !== "admin") throw new ApiError(403, "Insufficient permissions");
  return user;
}

/* ------------------------------------------------------------------ */
/* Document numbers + audit log                                        */
/* ------------------------------------------------------------------ */

export async function nextDocumentNumber(documentType: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await db.rpc("next_document_number", {
    p_document_type: documentType,
    p_year: year,
  });
  if (error) throw new ApiError(500, error.message);
  const sequence = String(data).padStart(5, "0");
  return `${prefix}${year}-${sequence}`;
}

export async function recordAudit(input: {
  userId: number;
  action: string;
  entityType: string;
  entityId?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.from("audit_logs").insert({
    user_id: input.userId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: (input.metadata ?? null) as any,
  } as any);
}

export function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export interface RouteDef {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Path relative to the API base, e.g. "invoices/:id/pdf". */
  path: string;
  handler: (ctx: Ctx) => Promise<any>;
}
