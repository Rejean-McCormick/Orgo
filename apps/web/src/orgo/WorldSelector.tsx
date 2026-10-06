import { useEffect, useMemo, useState } from "react";
import type { Actor } from "./api";
import { activeWorldKey } from "./api";

type WorldSummary = {
  id: string;
  key: string;
  title: string;
  status: string;
  is_default?: boolean;
  current_release?: { id: string; release_number: number; status: string } | null;
};

const WORLD_KEY = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function storageKey(actor: Actor) {
  return `orgo.active-world:${actor.organizationId}`;
}

export function WorldSelector({ actor }: { actor: Actor }) {
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => activeWorldKey(actor.organizationId));

  const headers = useMemo(
    () => ({
      "X-Orgo-Organization-Id": actor.organizationId,
      "X-Orgo-User-Id": actor.actorUserId ?? "00000000-0000-4000-8000-000000000001",
      "X-Orgo-Permissions": actor.permissions.join(","),
    }),
    [actor],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/worlds-api/control/worlds", { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error(`World service HTTP ${response.status}`);
        return (await response.json()) as WorldSummary[];
      })
      .then((rows) => {
        if (cancelled) return;
        setWorlds(rows);
        const current = activeWorldKey(actor.organizationId);
        const admitted = rows.find((world) => world.key === current && world.status !== "archived" && world.current_release);
        const fallback = rows.find((world) => world.is_default && world.status !== "archived" && world.current_release) ?? rows.find((world) => world.status !== "archived" && world.current_release);
        const resolved = admitted?.key ?? fallback?.key ?? "main";
        setSelected(resolved);
        window.localStorage.setItem(storageKey(actor), resolved);
        window.localStorage.setItem("orgo.active-world", resolved);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "World service unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actor, headers]);

  return (
    <label className="world-label">
      World
      <select
        aria-label="World actif"
        value={selected}
        disabled={loading || worlds.length === 0}
        onChange={(event) => {
          const key = event.target.value;
          if (!WORLD_KEY.test(key) || key === selected) return;
          window.localStorage.setItem(storageKey(actor), key);
          window.localStorage.setItem("orgo.active-world", key);
          setSelected(key);
          window.location.reload();
        }}
      >
        {worlds.map((world) => (
          <option
            key={world.id}
            value={world.key}
            disabled={world.status === "archived" || !world.current_release}
          >
            {world.title} · r{world.current_release?.release_number ?? "—"}
          </option>
        ))}
      </select>
      <small className={error ? "world-status is-error" : "world-status"}>
        {error || (loading ? "Chargement des Worlds…" : `${worlds.length} World${worlds.length === 1 ? "" : "s"} disponible${worlds.length === 1 ? "" : "s"}`)}
      </small>
    </label>
  );
}
