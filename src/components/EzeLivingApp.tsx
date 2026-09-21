import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const MigratedApp = lazy(() => import("../../client/src/EmbeddedApp"));

export function EzeLivingApp() {
  return (
    <ClientOnly fallback={<div className="page-loading">Loading...</div>}>
      <Suspense fallback={<div className="page-loading">Loading...</div>}>
        <MigratedApp />
      </Suspense>
    </ClientOnly>
  );
}