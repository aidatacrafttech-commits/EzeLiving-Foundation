import bcrypt from "bcryptjs";
import { z } from "zod";

import { ApiError, db, recordAudit, signToken, toCamel, type Ctx, type RouteDef } from "./core.server";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function login(ctx: Ctx) {
  const { email, password } = loginSchema.parse(ctx.body);

  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (!user || !user.is_active) throw new ApiError(401, "Invalid email or password");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new ApiError(401, "Invalid email or password");

  await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
  await recordAudit({ userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id });

  const token = await signToken({ id: user.id, email: user.email, role: user.role as "admin" | "staff" });

  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  };
}

async function me(ctx: Ctx) {
  if (!ctx.user) throw new ApiError(401, "Missing or invalid Authorization header");
  const { data: user } = await db.from("users").select("*").eq("id", ctx.user.id).maybeSingle();
  if (!user) throw new ApiError(404, "User not found");
  return toCamel({ id: user.id, name: user.name, email: user.email, role: user.role });
}

export const authRoutes: RouteDef[] = [
  { method: "POST", path: "auth/login", handler: login },
  { method: "GET", path: "auth/me", handler: me },
];
