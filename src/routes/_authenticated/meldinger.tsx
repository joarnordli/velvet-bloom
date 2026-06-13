import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/meldinger")({
  head: () => ({
    meta: [
      { title: "mittpunkt – Meldinger" },
      { name: "description", content: "Dine samtaler på mittpunkt." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <Outlet />,
});
