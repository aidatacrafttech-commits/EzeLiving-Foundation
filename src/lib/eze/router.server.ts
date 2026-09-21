import { ZodError } from "zod";

import { ApiError, readUser, type Ctx, type RouteDef } from "./core.server";
import { authRoutes } from "./auth.server";
import { catalogRoutes } from "./catalog.server";
import { productRoutes } from "./products.server";
import { stockRoutes } from "./stock.server";
import { invoiceRoutes } from "./invoices.server";
import { holdRoutes } from "./holds.server";
import { purchaseRoutes } from "./purchases.server";

const routes: RouteDef[] = [
  ...authRoutes,
  ...catalogRoutes,
  ...productRoutes,
  ...stockRoutes,
  ...invoiceRoutes,
  ...holdRoutes,
  ...purchaseRoutes,
];

function match(route: RouteDef, method: string, segments: string[]) {
  if (route.method !== method) return null;
  const pattern = route.path.split("/").filter(Boolean);
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] as string;
    const s = segments[i] as string;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(s);
    else if (p !== s) return null;
  }
  return params;
}

export async function dispatch(request: Request, splat: string): Promise<Response> {
  const url = new URL(request.url);
  const segments = splat.split("/").filter(Boolean);
  const method = request.method.toUpperCase();

  try {
    for (const route of routes) {
      const params = match(route, method, segments);
      if (!params) continue;

      let body: any = undefined;
      if (method !== "GET" && method !== "DELETE") {
        const text = await request.text();
        body = text ? JSON.parse(text) : {};
      }

      const ctx: Ctx = {
        user: await readUser(request),
        params,
        query: url.searchParams,
        body,
        request,
      };

      const result = await route.handler(ctx);
      if (result instanceof Response) return result;
      const status = method === "POST" && !("__status" in (result ?? {})) ? 200 : 200;
      return Response.json(result ?? null, { status });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "Validation error", details: error.flatten() }, { status: 400 });
    }
    if (error instanceof ApiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("[eze-api]", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
