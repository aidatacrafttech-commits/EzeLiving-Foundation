import { createFileRoute } from "@tanstack/react-router";
import { EzeLivingApp } from "../components/EzeLivingApp";

export const Route = createFileRoute("/$")({
  component: EzeLivingApp,
});