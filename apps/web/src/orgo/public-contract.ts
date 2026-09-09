import type { Actor } from "./api";
import { profiles, routes } from "./profiles";
/** Orgo-owned export. A Koali adapter must map this to its real supported host contract. */
export const orgoSurface = {
  id: "orgo",
  contract: "orgo-surface/v1",
  title: "Orgo",
  standalonePath: "/",
  hostedEntry: "src/orgo/hosted-entry.tsx",
  routes: Object.entries(routes).map(([path, route]) => ({ path, ...route })),
  profiles: Object.keys(profiles),
} as const;
export function visibleCommands(actor: Actor) {
  const permitted = (permission: string) =>
    actor.permissions.includes("*") ||
    actor.permissions.includes(permission) ||
    (permission.startsWith("work:") &&
      (actor.workGrants ?? []).some((g) => g.permissions.includes(permission)));
  return orgoSurface.routes
    .filter((route) => permitted(route.permission))
    .map((route) => ({
      id: `orgo.open.${route.path}`,
      title: route.label,
      route: route.path,
    }));
}
