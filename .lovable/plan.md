# Restore the migrated EzeLiving application

## Diagnosis

The live Preview starts the root TanStack application, whose `/` route explicitly renders the “Workspace ready” placeholder. The migrated application is a separate Vite app under `client/`, so its `main.tsx`, `App.tsx`, route table, global CSS, fonts, dependencies, and public logo are never loaded by Preview.

## Implementation

- Keep all migrated pages, components, business behavior, and visual styling intact.
- Mount the migrated `App` from the active root application and preserve its existing theme, authentication, and cart providers.
- Translate the existing route table into TanStack route files for every current URL, including protected admin pages and detail pages; do not introduce new screens.
- Add a small navigation compatibility layer so existing page and layout components retain their current navigation behavior without redesigning them.
- Load the complete migrated global stylesheet and its existing Google font families.
- Copy the migrated logo into the active public assets and install only the dependencies already declared by the migrated client.
- Remove the placeholder page from the active `/` route and use the original billing screen there (with the original login redirect when signed out).

## Verification

- Confirm the project compiles through the automatic harness.
- Open Preview at `/` and verify it reaches the original styled login or billing UI.
- Exercise login navigation as far as the migrated API availability permits, and verify direct routing plus logo/font/style loading on desktop and mobile.
