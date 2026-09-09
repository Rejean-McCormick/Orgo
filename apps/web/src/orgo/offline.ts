import { Actor, OrgoClient, Row } from "./api";
export type OfflineCommand = {
  id: string;
  operation: "task.create" | "task.status" | "signal.accept";
  payload: Record<string, unknown>;
  created_at: string;
  error?: string;
};
/** Queue contains deliberate commands only, partitioned by API, tenant and user. Never stores tokens. */
export class OfflineQueue {
  constructor(
    private actor: Actor,
    private api: string,
  ) {}
  private key() {
    return `orgo.queue.v1:${this.api}:${this.actor.organizationId}:${this.actor.actorUserId ?? "service"}`;
  }
  list(): OfflineCommand[] {
    const raw = localStorage.getItem(this.key());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed))
      throw new Error(
        "File locale illisible. Exportez les données avant de la réinitialiser.",
      );
    return parsed as OfflineCommand[];
  }
  private save(items: OfflineCommand[]) {
    localStorage.setItem(this.key(), JSON.stringify(items));
  }
  add(
    operation: OfflineCommand["operation"],
    payload: Record<string, unknown>,
  ) {
    const items = this.list();
    if (items.length >= 200)
      throw new Error("La file locale contient déjà 200 commandes.");
    const command = {
      id: crypto.randomUUID(),
      operation,
      payload,
      created_at: new Date().toISOString(),
    };
    this.save([...items, command]);
    return command;
  }
  remove(id: string) {
    this.save(this.list().filter((c) => c.id !== id));
  }
  replace(id: string, payload: Record<string, unknown>) {
    const old = this.list().find((c) => c.id === id);
    if (!old) throw new Error("Commande introuvable");
    this.save(
      this.list().map((c) =>
        c.id === id
          ? { ...c, id: crypto.randomUUID(), payload, error: undefined }
          : c,
      ),
    );
  }
  async replay(client: OrgoClient) {
    const batch = this.list()
      .filter((c) => !c.error)
      .slice(0, 50);
    if (!batch.length) return;
    const response = await client.request<{
      results: {
        id: string;
        ok: boolean;
        error?: { code: string; message: string };
      }[];
    }>("sync/replay", "POST", {
      commands: batch.map(({ id, operation, payload }) => ({
        id,
        operation,
        payload,
      })),
    });
    // Merge against current storage so commands added while online delivery runs survive.
    this.save(
      this.list().flatMap((command) => {
        const result = response.results.find((r) => r.id === command.id);
        return !result
          ? [command]
          : result.ok
            ? []
            : [
                {
                  ...command,
                  error: `${result.error?.code}: ${result.error?.message}`,
                },
              ];
      }),
    );
  }
}
