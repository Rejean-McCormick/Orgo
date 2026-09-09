import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Actor, can, OrgoClient, Row, rowId, rows, str } from "./api";
import { OfflineCommand, OfflineQueue } from "./offline";
export const extensionSections = [
  "notifications",
  "processes",
  "identity",
  "maintenance",
  "hr",
  "education",
  "communications",
  "system",
  "offline",
  "routing",
  "reports",
];
type Props = {
  client: OrgoClient;
  actor: Actor;
  section: string;
  apiBase?: string;
};
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : null;
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fieldLabels: Record<string, string> = {
  title: "Titre",
  description: "Description",
  name: "Nom",
  display_name: "Nom affiché",
  email: "Courriel",
  password: "Mot de passe",
  label: "Libellé",
  subject_id: "Référence du travail",
  subject_type: "Type de travail",
  person_id: "Référence de la personne",
  asset_id: "Équipement",
  case_code: "Code du dossier",
  role_id: "Rôle",
  role_ids: "Rôles",
  scope_type: "Type de périmètre",
  scope_reference: "Périmètre",
  start_at: "Début",
  end_at: "Fin",
  reason: "Motif",
  notes: "Notes",
  score: "Score",
  expires_at: "Expiration",
  permissions: "Permissions",
  scopes: "Permissions du jeton",
  steps: "Étapes",
  recipient_user_id: "Destinataire",
  subject: "Objet",
  body: "Message",
  subject_template: "Objet du modèle",
  body_template: "Texte du modèle",
  variables: "Variables",
  channel: "Canal",
  is_active: "Actif",
  is_fallback: "Règle de secours",
  weight: "Priorité de routage",
  target_user_id: "Responsable",
  operation: "Opération",
  payload: "Commande",
  version: "Version actuelle",
  updated_at: "Version courante",
  revision: "Révision",
  task: "Tâche",
  case: "Dossier",
  days: "Ancienneté minimale (jours)",
  purge_deleted_attachments: "Purger les fichiers déjà retirés",
};
function StructuredFields({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange(value: Record<string, unknown>): void;
}) {
  return (
    <>
      {Object.entries(value).map(([key, item]) => {
        const label = fieldLabels[key] ?? key.replaceAll("_", " "),
          set = (next: unknown) => onChange({ ...value, [key]: next });
        if (
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          Object.keys(item).length
        )
          return (
            <fieldset key={key}>
              <legend>{label}</legend>
              <StructuredFields
                value={item as Record<string, unknown>}
                onChange={set}
              />
            </fieldset>
          );
        if (typeof item === "boolean")
          return (
            <label key={key}>
              <span>{label}</span>
              <input
                type="checkbox"
                checked={item}
                onChange={(e) => set(e.target.checked)}
              />
            </label>
          );
        if (typeof item === "number")
          return (
            <label key={key}>
              {label}
              <input
                type="number"
                value={item}
                onChange={(e) => set(Number(e.target.value))}
              />
            </label>
          );
        if (Array.isArray(item) || (item && typeof item === "object"))
          return (
            <label key={key}>
              {label}
              <JsonValue value={item} onChange={set} />
            </label>
          );
        const options: Record<string, string[]> = {
          subject_type: ["case", "task"],
          target_type: ["case", "task"],
          kind: ["related", "blocks", "duplicates", "follows"],
          channel: ["in_app", "email", "sms", "webhook"],
          scope_type: ["team", "location", "unit", "custom"],
          provider: ["kristal", "konnaxion", "architect", "koa"],
          category: ["request", "incident", "alert", "update", "feedback"],
          role: [
            "complainant",
            "respondent",
            "witness",
            "advocate",
            "other",
          ].includes(str(item))
            ? ["complainant", "respondent", "witness", "advocate", "other"]
            : ["student", "player", "parent", "coach", "teacher", "mentor"],
        };
        if (options[key])
          return (
            <label key={key}>
              {label}
              <select value={str(item)} onChange={(e) => set(e.target.value)}>
                {options[key].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          );
        return (
          <label key={key}>
            {label}
            {/body|description|notes|reason/.test(key) ? (
              <textarea
                value={str(item)}
                onChange={(e) => set(e.target.value)}
                rows={3}
              />
            ) : (
              <input
                autoComplete="off"
                type={
                  key.includes("password")
                    ? "password"
                    : key === "email"
                      ? "email"
                      : "text"
                }
                value={str(item)}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </label>
        );
      })}
    </>
  );
}
function JsonValue({
  value,
  onChange,
}: {
  value: unknown;
  onChange(value: unknown): void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [invalid, setInvalid] = useState(false);
  return (
    <>
      <textarea
        rows={5}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setInvalid(false);
            e.currentTarget.setCustomValidity("");
          } catch {
            setInvalid(true);
            e.currentTarget.setCustomValidity("JSON invalide");
          }
        }}
        aria-invalid={invalid}
      />
      {invalid && (
        <small>JSON incomplet : la dernière valeur valide reste active.</small>
      )}
    </>
  );
}
function omitBlankReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitBlankReferences);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k, v]) =>
            !((k.endsWith("_id") || k === "recipient_address") && v === ""),
        )
        .map(([k, v]) => [k, omitBlankReferences(v)]),
    );
  return value;
}
function JsonForm({
  title,
  initial,
  onSubmit,
}: {
  title: string;
  initial: unknown;
  onSubmit(value: Record<string, unknown>): Promise<unknown>;
}) {
  const [value, setValue] = useState(JSON.stringify(initial, null, 2)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<unknown>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(
        await onSubmit(
          omitBlankReferences(JSON.parse(value)) as Record<string, unknown>,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel form-panel">
      <summary>{title}</summary>
      <form onSubmit={submit}>
        <StructuredFields
          value={JSON.parse(value)}
          onChange={(v) => setValue(JSON.stringify(v, null, 2))}
        />
        <ErrorText error={error} />
        <button disabled={busy} className="primary">
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        {result !== undefined && (
          <pre className="json-result">{JSON.stringify(result, null, 2)}</pre>
        )}
      </form>
    </details>
  );
}
function useRows(client: OrgoClient, path: string) {
  const [items, setItems] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    client
      .request<Row[] | { items: Row[] }>(path)
      .then((r) => {
        if (live) {
          setItems(Array.isArray(r) ? r : r.items);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [client, path, revision]);
  return { items, error, reload: () => setRevision((r) => r + 1) };
}
function DataList({
  items,
  onSelect,
}: {
  items: Row[];
  onSelect?(row: Row): void;
}) {
  return (
    <div className="panel table-scroll">
      <table>
        <thead>
          <tr>
            <th>Élément</th>
            <th>État / rôle</th>
            <th>Référence</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={rowId(item)}>
              <td>
                {onSelect ? (
                  <button className="row-link" onClick={() => onSelect(item)}>
                    {str(
                      item.title ??
                        item.name ??
                        item.display_name ??
                        item.case_code ??
                        item.code ??
                        item.person_id ??
                        item.id,
                    )}
                  </button>
                ) : (
                  str(
                    item.title ??
                      item.name ??
                      item.display_name ??
                      item.case_code ??
                      item.code ??
                      item.id,
                  )
                )}
              </td>
              <td>{str(item.status ?? item.role ?? item.channel)}</td>
              <td>
                <small>{rowId(item)}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="empty">Aucun élément.</p>}
    </div>
  );
}
export function Extensions(props: Props) {
  switch (props.section) {
    case "notifications":
      return <NotificationInbox {...props} />;
    case "processes":
      return <Processes {...props} />;
    case "identity":
      return <Identity {...props} />;
    case "maintenance":
      return <Maintenance {...props} />;
    case "hr":
      return <Hr {...props} />;
    case "education":
      return <Education {...props} />;
    case "communications":
      return <Communications {...props} />;
    case "system":
      return <System {...props} />;
    case "offline":
      return <Offline {...props} />;
    case "routing":
      return <Routing {...props} />;
    case "reports":
      return <Reports {...props} />;
    default:
      return null;
  }
}
function Processes({ client, actor }: Props) {
  const [offset, setOffset] = useState(0),
    list = useRows(client, `processes?offset=${offset}&limit=30`),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  async function action(decision: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const row = await client.request<Row>(
        `processes/${rowId(selected)}/decision`,
        "POST",
        { decision, reason, revision: selected.revision },
      );
      setSelected(row);
      list.reload();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="extension-stack">
      <ErrorText error={error || list.error} />
      {can(actor, "workflows:execute") && (
        <JsonForm
          title="Démarrer un processus"
          initial={{
            title: "Validation puis décision",
            subject_type: "case",
            subject_id: "",
            steps: [
              {
                kind: "integration",
                title: "Validation",
                request: {
                  provider: "kristal",
                  operation: "validate",
                  request: {},
                },
                timeout_seconds: 86400,
              },
              {
                kind: "approval",
                title: "Décision responsable",
                permission: "workflows:approve",
              },
            ],
          }}
          onSubmit={async (v) => {
            const r = await client.request("processes", "POST", v);
            list.reload();
            return r;
          }}
        />
      )}
      <DataList items={list.items} onSelect={setSelected} />
      <div className="actions">
        <button
          disabled={!offset}
          onClick={() => setOffset((v) => Math.max(0, v - 30))}
        >
          Précédent
        </button>
        <button onClick={() => setOffset((v) => v + 30)}>Suivant</button>
      </div>
      {selected && (
        <section className="panel form-panel">
          <h2>{str(selected.title)}</h2>
          <p>
            {str(selected.status)} · Étape {Number(selected.step_index) + 1}
          </p>
          <ErrorText error={str(selected.error)} />
          <button
            onClick={async () => {
              try {
                setSelected(
                  await client.request<Row>(`processes/${rowId(selected)}`),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Recharger l’état
          </button>
          <pre className="json-result">
            {JSON.stringify(
              { plan: selected.plan, results: selected.results },
              null,
              2,
            )}
          </pre>
          {can(actor, "workflows:execute") && (
            <>
              <label>
                Motif de la décision
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="actions">
                {(selected.status === "WAITING_HUMAN"
                  ? ["approve", "reject"]
                  : selected.status === "BLOCKED"
                    ? ["retry", "cancel"]
                    : ["RUNNING", "WAITING_EXTERNAL", "WAITING_TIMER"].includes(
                          str(selected.status),
                        )
                      ? ["cancel"]
                      : []
                ).map((actionName) => (
                  <button
                    disabled={!reason.trim() || busy}
                    key={actionName}
                    onClick={() => void action(actionName)}
                  >
                    {
                      (
                        {
                          approve: "Approuver",
                          reject: "Refuser",
                          retry: "Reprendre",
                          cancel: "Annuler le processus",
                        } as Record<string, string>
                      )[actionName]
                    }
                  </button>
                ))}
              </div>
              {["BLOCKED", "CANCELLED", "COMPLETED"].includes(
                str(selected.status),
              ) && (
                <button
                  onClick={async () => {
                    try {
                      const r = await client.request<Row>(
                        `processes/${rowId(selected)}/compensate`,
                        "POST",
                        {},
                      );
                      setSelected(r);
                      list.reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Exécuter les compensations déclarées
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
function Identity({ client }: Props) {
  const users = useRows(client, "users"),
    tokens = useRows(client, "identity/tokens"),
    roles = useRows(client, "roles"),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState("");
  return (
    <div className="extension-stack">
      <ErrorText error={error || users.error || tokens.error || roles.error} />
      <JsonForm
        title="Créer un compte"
        initial={{ email: "", display_name: "", password: "" }}
        onSubmit={async (v) => {
          const r = await client.request("users", "POST", v);
          users.reload();
          return r;
        }}
      />
      <JsonForm
        title="Créer un rôle"
        initial={{
          code: "operator",
          display_name: "Opérateur",
          permissions: ["work:read", "work:write", "sync:write"],
        }}
        onSubmit={async (v) => {
          const r = await client.request("roles", "POST", v);
          roles.reload();
          return r;
        }}
      />
      <DataList items={users.items} onSelect={setSelected} />
      {selected && (
        <section className="panel form-panel">
          <h3>{str(selected.display_name)}</h3>
          <JsonForm
            key={`scope:${rowId(selected)}`}
            title="Attribuer un périmètre de travail"
            initial={{ role_id: "", scope_type: "team", scope_reference: "" }}
            onSubmit={(v) =>
              client.request(
                `identity/users/${rowId(selected)}/scopes`,
                "POST",
                v,
              )
            }
          />
          <JsonForm
            key={rowId(selected)}
            title="Attribuer des rôles"
            initial={{ role_ids: [] }}
            onSubmit={(v) =>
              client.request(`users/${rowId(selected)}/roles`, "PUT", v)
            }
          />
          <button
            onClick={async () => {
              try {
                await client.request(
                  `identity/users/${rowId(selected)}/invite`,
                  "POST",
                  {},
                );
                setError("Invitation mise en file d’envoi.");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Envoyer le lien d’accès
          </button>
          <button
            onClick={async () => {
              try {
                await client.request(
                  `identity/users/${rowId(selected)}/status`,
                  "PUT",
                  {
                    status:
                      selected.status === "disabled" ? "active" : "disabled",
                  },
                );
                users.reload();
                setSelected(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {selected.status === "disabled" ? "Réactiver" : "Désactiver"} le
            compte
          </button>
        </section>
      )}
      <JsonForm
        title="Relier une identité SSO"
        initial={{ user_id: "", subject: "" }}
        onSubmit={(v) => client.request("identity/sso", "POST", v)}
      />
      <JsonForm
        title="Inviter une personne sans mot de passe temporaire"
        initial={{ email: "", display_name: "", role_ids: [] }}
        onSubmit={async (v) => {
          const r = await client.request("identity/invitations", "POST", v);
          users.reload();
          return r;
        }}
      />
      <h2>Rôles</h2>
      <DataList items={roles.items} />
      <h2>Jetons d’intégration</h2>
      <p>
        Le secret est affiché une seule fois. Une réponse perdue exige de
        révoquer le jeton puis d’en créer un autre.
      </p>
      <JsonForm
        title="Créer un jeton"
        initial={{
          name: "Connecteur",
          scopes: ["signals:read", "signals:write"],
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        }}
        onSubmit={async (v) => {
          const r = await client.request("identity/tokens", "POST", v);
          tokens.reload();
          return r;
        }}
      />
      {tokens.items.map((token) => (
        <div className="panel form-panel" key={rowId(token)}>
          <strong>{str(token.name)}</strong>
          <p>{str(token.expires_at)}</p>
          <button
            onClick={async () => {
              try {
                await client.request(
                  `identity/tokens/${rowId(token)}`,
                  "DELETE",
                );
                tokens.reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Révoquer
          </button>
        </div>
      ))}
    </div>
  );
}
const taskSample = {
  title: "",
  description: "",
  label: "2.11",
  type: "maintenance",
  category: "request",
};
function Maintenance({ client, actor }: Props) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [error, setError] = useState("");
  const from = new Date(`${month || "2026-01"}-01T00:00:00Z`),
    to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  const assets = useRows(client, "maintenance/assets"),
    calendar = useRows(
      client,
      `maintenance/calendar?from=${from.toISOString()}&to=${to.toISOString()}`,
    );
  return (
    <div className="extension-stack">
      <ErrorText error={error || assets.error || calendar.error} />
      <label>
        Mois
        <input
          type="month"
          value={month}
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
      </label>
      {can(actor, "maintenance:write") && (
        <>
          <JsonForm
            title="Ajouter un équipement"
            initial={{ name: "", category: "", location: {} }}
            onSubmit={async (v) => {
              const r = await client.request("maintenance/assets", "POST", v);
              assets.reload();
              return r;
            }}
          />
          <JsonForm
            title="Planifier une intervention"
            initial={{
              title: "",
              asset_id: "",
              start_at: from.toISOString(),
              end_at: new Date(+from + 3600000).toISOString(),
            }}
            onSubmit={async (v) => {
              const r = await client.request("maintenance/calendar", "POST", v);
              calendar.reload();
              return r;
            }}
          />
          <JsonForm
            title="Créer la tâche de maintenance"
            initial={{ asset_id: "", task: taskSample }}
            onSubmit={(v) => client.request("maintenance/tasks", "POST", v)}
          />
        </>
      )}
      <h2>Équipements</h2>
      <DataList items={assets.items} />
      <h2>Calendrier</h2>
      {calendar.items.map((slot) => (
        <section className="panel form-panel" key={rowId(slot)}>
          <h3>{str(slot.title)}</h3>
          <p>
            {new Date(str(slot.start_at)).toLocaleString()} →{" "}
            {new Date(str(slot.end_at)).toLocaleString()} · {str(slot.status)}
          </p>
          {can(actor, "maintenance:write") && (
            <div className="actions">
              {(slot.status === "planned"
                ? ["in_progress", "cancelled"]
                : slot.status === "in_progress"
                  ? ["completed", "cancelled"]
                  : []
              ).map((status) => (
                <button
                  key={status}
                  onClick={async () => {
                    try {
                      await client.request(
                        `maintenance/calendar/${rowId(slot)}/status`,
                        "PUT",
                        { status, updated_at: slot.updated_at },
                      );
                      calendar.reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {status}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
function Hr({ client, actor }: Props) {
  const list = useRows(client, "hr/cases"),
    [selected, setSelected] = useState<Row | null>(null),
    [error, setError] = useState("");
  return (
    <div className="extension-stack">
      <ErrorText error={error || list.error} />
      {can(actor, "hr:write") && (
        <>
          <JsonForm
            title="Ouvrir un dossier RH confidentiel"
            initial={{
              case_code: "",
              case: { title: "", label: "2.11" },
              task: { ...taskSample, type: "hr_case" },
            }}
            onSubmit={async (v) => {
              const r = await client.request("hr/cases", "POST", v);
              list.reload();
              return r;
            }}
          />
          <JsonForm
            title="Enregistrer un suivi de bien-être"
            initial={{ person_id: "", score: 5, comment: "", tags: [] }}
            onSubmit={(v) => client.request("hr/wellbeing", "POST", v)}
          />
        </>
      )}
      <DataList
        items={list.items}
        onSelect={(r) => {
          void client
            .request<Row>(`hr/cases/${rowId(r)}`)
            .then(setSelected)
            .catch((e) => setError(e.message));
        }}
      />
      {selected && (
        <section className="panel form-panel">
          <h2>{str(selected.case_code)}</h2>
          <DataList items={rows(selected.participants)} />
          {can(actor, "hr:write") && (
            <>
              <JsonForm
                key={`participant:${rowId(selected)}`}
                title="Ajouter un participant"
                initial={{ person_id: "", role: "witness", notes: "" }}
                onSubmit={async (v) => {
                  const r = await client.request(
                    `hr/cases/${rowId(selected)}/participants`,
                    "POST",
                    v,
                  );
                  setSelected(
                    await client.request<Row>(`hr/cases/${rowId(selected)}`),
                  );
                  return r;
                }}
              />
              <JsonForm
                key={`review:${selected.updated_at}`}
                title="Enregistrer une décision RH"
                initial={{
                  status: "under_review",
                  reason: "",
                  updated_at: selected.updated_at,
                }}
                onSubmit={async (v) => {
                  const r = await client.request<Row>(
                    `hr/cases/${rowId(selected)}/review`,
                    "PUT",
                    v,
                  );
                  setSelected(r);
                  list.reload();
                  return r;
                }}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
function Education({ client, actor }: Props) {
  const groups = useRows(client, "education/groups"),
    [group, setGroup] = useState(""),
    [members, setMembers] = useState<Row[]>([]),
    [error, setError] = useState("");
  const reload = useCallback(() => {
    if (group)
      void client
        .request<Row[]>(`education/groups/${group}/members`)
        .then(setMembers)
        .catch((e) => setError(e.message));
  }, [client, group]);
  useEffect(reload, [reload]);
  return (
    <div className="extension-stack">
      <ErrorText error={error || groups.error} />
      {can(actor, "education:write") && (
        <JsonForm
          title="Créer un groupe"
          initial={{ code: "", name: "", description: "" }}
          onSubmit={async (v) => {
            const r = await client.request("education/groups", "POST", v);
            groups.reload();
            return r;
          }}
        />
      )}
      <DataList items={groups.items} onSelect={(r) => setGroup(rowId(r))} />
      {group && (
        <>
          <h2>Membres</h2>
          <DataList items={members} />
          {can(actor, "education:write") && (
            <>
              <JsonForm
                title="Ajouter un membre"
                initial={{ person_id: "", role: "student" }}
                onSubmit={async (v) => {
                  const r = await client.request(
                    `education/groups/${group}/members`,
                    "POST",
                    v,
                  );
                  reload();
                  return r;
                }}
              />
              <JsonForm
                key={group}
                title="Créer une tâche de soutien"
                initial={{
                  learning_group_id: group,
                  task: { ...taskSample, type: "education_support" },
                }}
                onSubmit={(v) => client.request("education/tasks", "POST", v)}
              />
              {members.map((m) => (
                <button
                  key={rowId(m)}
                  onClick={async () => {
                    try {
                      await client.request(
                        `education/members/${rowId(m)}`,
                        "DELETE",
                      );
                      reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Retirer {str((m.person as Row)?.full_name ?? m.person_id)}
                </button>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
function Communications({ client }: Props) {
  const list = useRows(client, "communications/templates"),
    [template, setTemplate] = useState<Row | null>(null);
  return (
    <div className="extension-stack">
      <ErrorText error={list.error} />
      <JsonForm
        title="Créer un modèle de message"
        initial={{
          code: "reminder",
          version: 0,
          channel: "email",
          subject_template: "Suivi : {{title}}",
          body_template: "Bonjour {{name}},\n{{message}}",
          is_active: true,
        }}
        onSubmit={async ({ code, ...v }) => {
          const r = await client.request(
            `communications/templates/${encodeURIComponent(str(code))}`,
            "PUT",
            v,
          );
          list.reload();
          return r;
        }}
      />
      <DataList items={list.items} onSelect={setTemplate} />
      {template && (
        <JsonForm
          key={rowId(template)}
          title={`Envoyer ${str(template.code)}`}
          initial={{
            recipient_user_id: "",
            recipient_address: "",
            variables: { title: "", name: "", message: "" },
          }}
          onSubmit={(v) =>
            client.request(
              `communications/templates/${encodeURIComponent(str(template.code))}/send`,
              "POST",
              v,
            )
          }
        />
      )}
      <JsonForm
        title="Envoyer un message"
        initial={{
          channel: "in_app",
          recipient_user_id: "",
          recipient_address: "",
          subject: "",
          body: "",
        }}
        onSubmit={(v) => client.request("notifications", "POST", v)}
      />
    </div>
  );
}
function System({ client }: Props) {
  const list = useRows(client, "outbox?status=DEAD"),
    [overview, setOverview] = useState<Row>({}),
    [error, setError] = useState("");
  useEffect(() => {
    void client
      .request<Row>("system/overview")
      .then(setOverview)
      .catch((e) => setError(e.message));
  }, [client]);
  return (
    <div className="extension-stack">
      <ErrorText error={error || list.error} />
      <section className="panel form-panel">
        <h2>Traitements et workers</h2>
        <pre className="json-result">{JSON.stringify(overview, null, 2)}</pre>
      </section>
      <h2>Messages à reprendre</h2>
      {list.items.map((row) => (
        <div className="panel form-panel" key={rowId(row)}>
          <p>
            {str(row.type)} · {str(row.last_error)}
          </p>
          <button
            onClick={async () => {
              try {
                await client.request(
                  `outbox/${rowId(row)}/redrive`,
                  "POST",
                  {},
                );
                list.reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Remettre en file
          </button>
        </div>
      ))}
      <JsonForm
        title="Appliquer la rétention"
        initial={{ days: 90, purge_deleted_attachments: false }}
        onSubmit={(v) => client.request("system/retention", "POST", v)}
      />
    </div>
  );
}
function Routing({ client }: Props) {
  const list = useRows(client, "routing/rules");
  return (
    <div className="extension-stack">
      <ErrorText error={list.error} />
      <DataList items={list.items} />
      <JsonForm
        title="Créer une règle de routage"
        initial={{
          name: "",
          label_codes: ["2.11"],
          weight: 10,
          is_fallback: false,
          target_user_id: "",
        }}
        onSubmit={async (v) => {
          const r = await client.request("routing/rules", "POST", v);
          list.reload();
          return r;
        }}
      />
    </div>
  );
}
function Reports({ client }: Props) {
  const [error, setError] = useState("");
  return (
    <section className="panel form-panel">
      <h2>Export des tâches visibles</h2>
      <p>Export CSV paginé, jusqu’à 5 000 tâches par fichier.</p>
      <ErrorText error={error} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          try {
            const data = await client.download(
              `reports/tasks.csv?offset=${form.get("offset")}&limit=5000`,
            );
            download("orgo-tasks.csv", data, "text/csv");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          Décalage
          <input
            name="offset"
            type="number"
            min="0"
            step="5000"
            defaultValue="0"
            required
          />
        </label>
        <button>Exporter</button>
      </form>
    </section>
  );
}
function Offline({ client, actor, apiBase }: Props) {
  const queue = useMemo(
      () => new OfflineQueue(actor, apiBase ?? "/api/v3"),
      [actor, apiBase],
    ),
    [items, setItems] = useState<OfflineCommand[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    try {
      setItems(queue.list());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [queue]);
  useEffect(reload, [reload]);
  return (
    <div className="extension-stack">
      <p>
        Les commandes restent sur cet appareil, dans la file de votre compte. La
        synchronisation nécessite une session active. Une commande en conflit
        reste à examiner.
      </p>
      <ErrorText error={error} />
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await queue.replay(client);
              reload();
              setError("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Synchroniser
        </button>
        <button
          onClick={() =>
            download(
              "orgo-offline-commands.json",
              JSON.stringify(items, null, 2),
            )
          }
        >
          Exporter la file
        </button>
      </div>
      <JsonForm
        title="Préparer une commande hors ligne"
        initial={{ operation: "task.create", payload: taskSample }}
        onSubmit={async (v) => {
          if (
            !["task.create", "task.status", "signal.accept"].includes(
              str(v.operation),
            )
          )
            throw new Error("Opération non prise en charge");
          queue.add(
            v.operation as OfflineCommand["operation"],
            v.payload as Row,
          );
          reload();
          return { queued: true };
        }}
      />
      {items.map((item) => (
        <section className="panel form-panel" key={item.id}>
          <h3>{item.operation}</h3>
          <ErrorText error={item.error ?? ""} />
          <pre className="json-result">
            {JSON.stringify(item.payload, null, 2)}
          </pre>
          {item.error && (
            <JsonForm
              title="Corriger puis réessayer avec une nouvelle identité"
              initial={item.payload}
              onSubmit={async (v) => {
                queue.replace(item.id, v);
                reload();
                return { updated: true };
              }}
            />
          )}
          <button
            onClick={() => {
              queue.remove(item.id);
              reload();
            }}
          >
            Retirer de la file
          </button>
        </section>
      ))}
    </div>
  );
}
export function EvidencePanel({
  client,
  actor,
  type,
  id,
}: {
  client: OrgoClient;
  actor: Actor;
  type: "task" | "case";
  id: string;
}) {
  const [version, setVersion] = useState(0),
    [offset, setOffset] = useState(0),
    [attachments, setAttachments] = useState<Row[]>([]),
    [events, setEvents] = useState<Row[]>([]),
    [relations, setRelations] = useState<Row[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all([
      client.request<Row[]>(`work/${type}/${id}/attachments?limit=100`),
      client.request<{ items: Row[] }>(
        `work/${type}/${id}/timeline?offset=${offset}&limit=20`,
      ),
      client.request<{ items: Row[] }>(
        `work/${type}/${id}/relations?limit=100`,
      ),
    ])
      .then(([a, e, r]) => {
        if (live) {
          setAttachments(a);
          setEvents(e.items);
          setRelations(r.items);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [client, type, id, version, offset]);
  return (
    <section className="evidence">
      <ErrorText error={error} />
      <h3>Pièces jointes</h3>
      {can(actor, "work:write") && (
        <label>
          Ajouter un fichier (1 Mio maximum)
          <input
            type="file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 1048576)
                  throw new Error("Le fichier dépasse 1 Mio.");
                const data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () =>
                    resolve(str(reader.result).split(",")[1]);
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
                });
                await client.request(`work/${type}/${id}/attachments`, "POST", {
                  filename: file.name,
                  media_type: file.type || "application/octet-stream",
                  content_base64: data,
                });
                setVersion((v) => v + 1);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
              e.target.value = "";
            }}
          />
        </label>
      )}
      {attachments.map((a) => (
        <div className="relation" key={rowId(a)}>
          <button
            onClick={async () => {
              try {
                const file = await client.request<Row>(
                  `attachments/${rowId(a)}`,
                );
                const bytes = Uint8Array.from(
                  atob(str(file.content_base64)),
                  (c) => c.charCodeAt(0),
                );
                const url = URL.createObjectURL(
                  new Blob([bytes], { type: "application/octet-stream" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = str(file.filename);
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {str(a.filename)} ({str(a.byte_length)} octets)
          </button>
          {can(actor, "work:write") && (
            <button
              aria-label={`Retirer ${str(a.filename)}`}
              onClick={async () => {
                try {
                  await client.request(`attachments/${rowId(a)}`, "DELETE");
                  setVersion((v) => v + 1);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Retirer
            </button>
          )}
        </div>
      ))}
      <h3>Relations</h3>
      {relations.map((r) => (
        <p key={rowId(r)}>
          {str(r.kind)} : {str(r.source_id)} → {str(r.target_id)}
        </p>
      ))}
      {can(actor, "work:write") && (
        <JsonForm
          title="Relier un travail"
          initial={{ target_type: "task", target_id: "", kind: "related" }}
          onSubmit={async (v) => {
            const r = await client.request(
              `work/${type}/${id}/relations`,
              "POST",
              v,
            );
            setVersion((v) => v + 1);
            return r;
          }}
        />
      )}
      <h3>Historique complet</h3>
      {events.map((e) => (
        <details key={rowId(e)}>
          <summary>
            {new Date(str(e.created_at)).toLocaleString()} · {str(e.event_type)}
          </summary>
          <pre className="json-result">
            {JSON.stringify(e.payload, null, 2)}
          </pre>
        </details>
      ))}
      <div className="actions">
        <button
          disabled={!offset}
          onClick={() => setOffset((v) => Math.max(0, v - 20))}
        >
          Précédent
        </button>
        <button
          disabled={events.length < 20}
          onClick={() => setOffset((v) => v + 20)}
        >
          Suivant
        </button>
      </div>
    </section>
  );
}

export function EditWork({
  client,
  row,
  type,
  onChange,
}: {
  client: OrgoClient;
  row: Row;
  type: "task" | "case";
  onChange(): void;
}) {
  return (
    <>
      <JsonForm
        key={`edit:${rowId(row)}:${row.revision}`}
        title="Modifier le travail"
        initial={{
          title: row.title,
          description: row.description,
          revision: row.revision,
        }}
        onSubmit={async (v) => {
          const result = await client.request(
            `${type === "task" ? "tasks" : "cases"}/${rowId(row)}`,
            "PATCH",
            v,
          );
          onChange();
          return result;
        }}
      />
      {type === "task" && (
        <JsonForm
          key={`parent:${rowId(row)}:${row.revision}`}
          title="Associer à un dossier"
          initial={{ case_id: row.case_id ?? "", revision: row.revision }}
          onSubmit={async (v) => {
            const result = await client.request(
              `tasks/${rowId(row)}/case`,
              "PATCH",
              { ...v, case_id: v.case_id || null },
            );
            onChange();
            return result;
          }}
        />
      )}
    </>
  );
}
export function EmailEvidence({
  client,
  id,
}: {
  client: OrgoClient;
  id: string;
}) {
  const [email, setEmail] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    client
      .request<Row>(`ingress/email/${id}`)
      .then((r) => {
        if (live) setEmail(r);
      })
      .catch((e) => {
        if (live && e.code !== "NOT_FOUND") setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [client, id]);
  return (
    <>
      <ErrorText error={error} />
      {email && (
        <section>
          <h3>Courriel reçu</h3>
          <p>{str(email.from)}</p>
          {rows(email.attachments).map((a) => (
            <button
              key={str(a.index)}
              onClick={async () => {
                try {
                  const file = await client.request<Row>(
                    `ingress/email/${id}/attachments/${a.index}`,
                  );
                  const bytes = Uint8Array.from(
                      atob(str(file.content_base64)),
                      (c) => c.charCodeAt(0),
                    ),
                    url = URL.createObjectURL(
                      new Blob([bytes], { type: "application/octet-stream" }),
                    );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = str(file.filename);
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {str(a.filename)}
            </button>
          ))}
        </section>
      )}
    </>
  );
}

function NotificationInbox({ client }: Props) {
  const [offset, setOffset] = useState(0),
    [unread, setUnread] = useState(false),
    [error, setError] = useState("");
  const list = useRows(
    client,
    `notifications?offset=${offset}&limit=30${unread ? "&status=unread" : ""}`,
  );
  return (
    <div className="extension-stack">
      <label>
        <input
          type="checkbox"
          checked={unread}
          onChange={(e) => {
            setUnread(e.target.checked);
            setOffset(0);
          }}
        />{" "}
        Non lus uniquement
      </label>
      <ErrorText error={error || list.error} />
      {list.items.map((n) => (
        <article key={rowId(n)} className="panel form-panel">
          <h2>{str((n.payload as Row)?.subject)}</h2>
          <p className="description">{str((n.payload as Row)?.body)}</p>
          <small>
            {str(n.status)} · {new Date(str(n.created_at)).toLocaleString()}
          </small>
          {!n.read_at && (
            <button
              onClick={async () => {
                try {
                  await client.request(
                    `notifications/${rowId(n)}/read`,
                    "PUT",
                    {},
                  );
                  list.reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Marquer comme lu
            </button>
          )}
        </article>
      ))}
      <div className="actions">
        <button
          disabled={!offset}
          onClick={() => setOffset((v) => Math.max(0, v - 30))}
        >
          Précédent
        </button>
        <button
          disabled={list.items.length < 30}
          onClick={() => setOffset((v) => v + 30)}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}
