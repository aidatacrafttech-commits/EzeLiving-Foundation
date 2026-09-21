import { createFileRoute } from "@tanstack/react-router";

async function handle(request: Request, splat: string | undefined) {
  const { dispatch } = await import("@/lib/eze/router.server");
  return dispatch(request, splat ?? "");
}

export const Route = createFileRoute("/api/public/eze/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handle(request, (params as any)._splat),
      POST: async ({ request, params }) => handle(request, (params as any)._splat),
      PUT: async ({ request, params }) => handle(request, (params as any)._splat),
      DELETE: async ({ request, params }) => handle(request, (params as any)._splat),
      OPTIONS: async () => new Response(null, { status: 204 }),
    },
  },
});
