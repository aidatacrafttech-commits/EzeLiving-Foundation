import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EzeLiving" },
      {
        name: "description",
        content:
          "EzeLiving — a blank project scaffold, ready for the ideas to come.",
      },
      { property: "og:title", content: "EzeLiving" },
      {
        property: "og:description",
        content:
          "EzeLiving — a blank project scaffold, ready for the ideas to come.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="font-display text-lg tracking-tight text-foreground">
          EzeLiving
        </span>
        <span className="font-sans text-[0.7rem] uppercase tracking-[0.28em] text-muted-foreground">
          Setup
        </span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="animate-rise font-sans text-[0.7rem] uppercase tracking-[0.32em] text-brand">
          Workspace ready
        </p>
        <h1 className="animate-rise font-display text-6xl leading-[0.95] tracking-tight text-foreground sm:text-8xl [animation-delay:80ms]">
          EzeLiving
        </h1>
        <span
          aria-hidden
          className="animate-rise mt-8 h-px w-24 bg-brand/40 [animation-delay:160ms]"
        />
        <p className="animate-rise mt-8 max-w-sm font-sans text-sm leading-relaxed text-muted-foreground [animation-delay:240ms]">
          Nothing built yet — just the frame. Tell me what EzeLiving should
          become and we'll start filling it in.
        </p>
      </section>

      <footer className="flex items-center justify-center px-6 py-6">
        <span className="font-sans text-[0.7rem] uppercase tracking-[0.28em] text-muted-foreground">
          v0.1
        </span>
      </footer>
    </main>
  );
}
