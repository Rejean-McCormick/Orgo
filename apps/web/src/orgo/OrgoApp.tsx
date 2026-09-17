import {
  Extensions,
  EvidencePanel,
  EditWork,
  EmailEvidence,
  extensionSections,
} from "./Extensions";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Actor, ApiError, can, OrgoClient, Row, rowId, rows, str } from "./api";
import { profiles, routes, Section } from "./profiles";
import { InteractionSurface, interactionSections } from "./InteractionSurfaces";

export interface OrgoAppProps {
  path: string[];
  navigate(path: string): void;
  mode?: "standalone" | "hosted";
  apiBase?: string;
  initialProfile?: string;
}
const states: Record<string, string[]> = {
  PENDING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "FAILED", "ESCALATED"],
  ON_HOLD: ["IN_PROGRESS", "CANCELLED"],
  ESCALATED: ["IN_PROGRESS", "COMPLETED", "FAILED"],
  open: ["in_progress", "resolved", "archived"],
  in_progress: ["resolved", "archived"],
  resolved: ["in_progress", "archived"],
};
const stateName: Record<string, string> = {
  PENDING: "To do",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  ESCALATED: "Escalated",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  archived: "Archived",
  RECEIVED: "Received",
  PROCESSED: "Processed",
  REJECTED: "Rejected",
  SUCCEEDED: "Succeeded",
  RUNNING: "In progress",
  DEAD: "Needs retry",
};
function Badge({ value }: { value: unknown }) {
  const v = str(value);
  return (
    <span className={`badge state-${v.toLowerCase()}`}>
      {stateName[v] ?? v}
    </span>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
function DateText({ value }: { value: unknown }) {
  return (
    <>
      {value
        ? new Date(str(value)).toLocaleString("en-CA", {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "—"}
    </>
  );
}
function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

export function OrgoApp({
  path,
  navigate,
  mode = "standalone",
  apiBase,
  initialProfile = "Operations",
}: OrgoAppProps) {
  const client = useMemo(() => new OrgoClient("", apiBase), [apiBase]);
  const [actor, setActor] = useState<Actor | null>(null),
    [authReady, setAuthReady] = useState(false),
    [profile, setProfile] = useState(initialProfile),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<Row[]>([]),
    [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null),
    [loading, setLoading] = useState(false),
    [version, refresh] = useState(0),
    [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const composition = profiles[profile] ?? profiles.Operations;
  const allowed = actor
    ? composition.sections.filter((s) => can(actor, routes[s].permission))
    : [];
  const requested = path[0] as Section;
  const section = allowed.includes(requested)
    ? requested
    : allowed.includes(composition.home)
      ? composition.home
      : allowed[0];
  const id = path[1];
  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const current = await client.request<Actor>('auth/me');
        if (!cancelled) setActor(current);
      } catch {
        try {
          const local = await client.request<{ context: Actor }>(
            'auth/local-auto-login',
            'POST',
          );
          if (!cancelled) setActor(local.context);
        } catch {
          // Normal when local auto-login is disabled or no session exists.
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [client]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setOffset(0);
  }, [section, query]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const reload = useCallback(() => refresh((v) => v + 1), []);
  useEffect(() => {
    if (!actor || !section) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setSelected(null);
    const endpoint =
      section === "my-work"
        ? "tasks"
        : section === "people"
          ? "people"
          : section === "integrations"
            ? "integration-operations"
            : section;
    const parameters = new URLSearchParams({
      limit: "30",
      offset: String(offset),
      ...(query ? { search: query } : {}),
      ...(section === "my-work" ? { mine: "true" } : {}),
    });
    const normal = [
      "cases",
      "tasks",
      "signals",
      "my-work",
      "audit",
      "integrations",
    ].includes(section);
    if (
      section === "insights" ||
      section === "settings" ||
      interactionSections.includes(section as (typeof interactionSections)[number]) ||
      extensionSections.includes(section)
    ) {
      setLoading(false);
      return;
    }
    client
      .request<Row | Row[]>(`${endpoint}${normal ? `?${parameters}` : ""}`)
      .then((value) => {
        if (cancelled) return;
        const list = Array.isArray(value) ? value : rows(value.items);
        setData(list);
        setTotal(
          Array.isArray(value)
            ? list.length
            : Number(value.total ?? list.length),
        );
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Unable to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    if (id && ["cases", "tasks", "signals", "my-work"].includes(section))
      client
        .request<Row>(`${endpoint}/${encodeURIComponent(id)}`)
        .then((value) => {
          if (!cancelled) setSelected(value);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [actor, client, section, id, offset, query, version]);

  if (!authReady)
    return (
      <main className="login no-view">
        <img className="standalone-logo" src="/logo_k.svg" alt="Orgo" />
        <p>Restoring your session…</p>
      </main>
    );
  if (!actor) return <Login client={client} onLogin={setActor} />;
  if (!section)
    return (
      <main className="login no-view">
        <img className="standalone-logo" src="/logo_k.svg" alt="Orgo" />
        <h1>Orgo</h1>
        <Empty>No view is authorized in this profile.</Empty>
        <select
          aria-label="Profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        >
          {Object.keys(profiles).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <button
          onClick={() => {
            client.token = "";
            setActor(null);
          }}
        >
          Sign out
        </button>
      </main>
    );
  const definition = routes[section];
  const go = (route: string) => {
    setCreating(false);
    setSearch("");
    navigate(route);
  };
  return (
    <div className={`app ${mode === "hosted" ? "hosted" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo_k.svg" alt="" aria-hidden="true" />
          <div>
            orgo<small>Organize and Go</small>
          </div>
        </div>
        <label className="profile-label">
          Workspace
          <select
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              navigate(profiles[e.target.value].home);
            }}
          >
            {Object.keys(profiles).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <nav aria-label="Navigation Orgo">
          {allowed.map((s) => (
            <button
              key={s}
              className={s === section ? "active" : ""}
              onClick={() => go(s)}
            >
              <span className="nav-dot" />
              {routes[s].label}
            </button>
          ))}
        </nav>
        {allowed.includes("intake") && can(actor, "signals:write") && (
          <button className="sidebar-report" onClick={() => go("intake")}>
            + Report something
          </button>
        )}
        <div className="sidebar-footer">
          <span className="connection">Connected organization</span>
          <button
            onClick={async () => {
              try {
                await client.request("auth/logout", "POST");
              } finally {
                client.token = "";
                setActor(null);
              }
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>{definition.label}</span>
          <label className="search">
            <span>Search</span>
            <input
              ref={searchRef}
              aria-label="Search this view"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title or label…"
            />
            <kbd>⌘ K</kbd>
          </label>
        </header>
        <div className="workspace">
          {interactionSections.includes(section as (typeof interactionSections)[number]) ? (
            <InteractionSurface
              section={section}
              client={client}
              actor={actor}
              navigate={navigate}
              query={query}
              path={path}
              version={version}
              reload={reload}
            />
          ) : (
            <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{profile}</p>
              <h1>{definition.label}</h1>
              <p>{definition.description}</p>
            </div>
            <div className="actions">
              <button onClick={reload}>Refresh</button>
              {["cases", "tasks", "signals"].includes(section) &&
                can(
                  actor,
                  section === "signals" ? "signals:write" : "work:write",
                ) && (
                  <button className="primary" onClick={() => setCreating(true)}>
                    +{" "}
                    {section === "cases"
                      ? "New case"
                      : section === "signals"
                        ? "New signal"
                        : "New task"}
                  </button>
                )}
            </div>
          </div>
          <ErrorMessage error={error} />
          {creating && (
            <CreateWork
              section={section}
              client={client}
              actor={actor}
              caseId={section === "tasks" ? undefined : id}
              onClose={() => setCreating(false)}
              onSave={() => {
                setCreating(false);
                reload();
              }}
            />
          )}
          {extensionSections.includes(section) ? (
            <Extensions
              key={section}
              section={section}
              client={client}
              actor={actor}
              apiBase={apiBase}
            />
          ) : section === "insights" ? (
            <Insights client={client} version={version} />
          ) : section === "settings" ? (
            <Settings client={client} actor={actor} />
          ) : section === "workflows" ? (
            <WorkflowAdmin
              client={client}
              actor={actor}
              workflows={data}
              onSave={reload}
            />
          ) : (
            <div className={`content-grid ${selected ? "with-detail" : ""}`}>
              <section className="panel">
                <div className="panel-heading">
                  <strong>
                    {loading
                      ? "Loading…"
                      : `${total} item${total !== 1 ? "s" : ""}`}
                  </strong>
                  <span>Current organization</span>
                </div>
                {data.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            {section === "people" ? "Person" : "Item"}
                          </th>
                          <th>Status</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.map((row) => (
                          <tr
                            key={rowId(row)}
                            className={rowId(row) === id ? "selected" : ""}
                          >
                            <td>
                              {[
                                "cases",
                                "tasks",
                                "signals",
                                "my-work",
                              ].includes(section) ? (
                                <button
                                  className="row-link"
                                  onClick={() =>
                                    navigate(`${section}/${rowId(row)}`)
                                  }
                                >
                                  {str(row.title)}
                                  <small>{str(row.label)}</small>
                                </button>
                              ) : (
                                <span>
                                  {str(
                                    row.full_name ??
                                      row.action ??
                                      row.operation ??
                                      row.channel ??
                                      row.code,
                                  )}
                                  <small className="muted">
                                    {str(row.provider ?? row.target_type)}
                                  </small>
                                </span>
                              )}
                            </td>
                            <td>
                              {row.status ? <Badge value={row.status} /> : "—"}
                            </td>
                            <td className="date-cell">
                              <DateText
                                value={row.created_at ?? row.received_at}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  !loading && (
                    <Empty>
                      {query
                        ? "No results for this search."
                        : "No items yet."}
                    </Empty>
                  )
                )}
                {total > 30 && (
                  <div className="pagination">
                    <button
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 30))}
                    >
                      Previous
                    </button>
                    <span>
                      {offset + 1}–{Math.min(offset + 30, total)}
                    </span>
                    <button
                      disabled={offset + 30 >= total}
                      onClick={() => setOffset(offset + 30)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>
              {selected && (
                <Detail
                  row={selected}
                  section={section}
                  client={client}
                  actor={actor}
                  onChange={reload}
                  navigate={navigate}
                  onClose={() => navigate(section)}
                />
              )}
            </div>
          )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Login({
  client,
  onLogin,
}: {
  client: OrgoClient;
  onLogin(actor: Actor): void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [sso, setSso] = useState<{
    available: boolean;
    display_name: string;
    local_login_available: boolean;
    identity_key: string;
  } | null>(null);
  const started = useRef(false);
  useEffect(() => {
    void client
      .request<{
        available: boolean;
        display_name: string;
        local_login_available: boolean;
        identity_key: string;
      }>("auth/sso/config")
      .then(setSso)
      .catch(() => {});
    const parameters = new URLSearchParams(window.location.search);
    const code = parameters.get("code"),
      state = parameters.get("state");
    if (code && state && !started.current) {
      started.current = true;
      setBusy(true);
      history.replaceState(null, "", window.location.pathname);
      void client
        .request<{ token: string; context: Actor }>(
          "auth/sso/complete",
          "POST",
          { code, state },
        )
        .then((r) => {
          client.token = r.token;
          onLogin(r.context);
        })
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }
  }, [client, onLogin]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await client.request<{ token: string; context: Actor }>(
        "auth/login",
        "POST",
        Object.fromEntries(data),
      );
      client.token = response.token;
      onLogin(response.context);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-story">
        <img className="login-logo" src="/logo_k.svg" alt="Orgo" />
        <h1>
          From signal
          <br />
          to completed work.
        </h1>
        <p>
          Bring the context together, assign actions, and track them through
          resolution.
        </p>
        <div className="story-line">
          <span>Signal</span>
          <span>Case</span>
          <span>Action</span>
        </div>
      </div>
      <form className="login-form" onSubmit={submit}>
        <h2>Your workspace</h2>
        <p>Sign in to your organization.</p>
        <label>
          Organization
          <input
            name="organization"
            required
            autoComplete="organization"
            placeholder="my-organization"
          />
        </label>
        <label>
          Email address
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        <ErrorMessage error={error} />
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <a href="/account">Forgot password or first access</a>
        {sso?.available && (
          <button
            type="button"
            disabled={busy}
            onClick={async (e) => {
              const organization = (
                e.currentTarget.form?.elements.namedItem(
                  "organization",
                ) as HTMLInputElement
              )?.value;
              if (!organization) {
                setError("Enter your organization.");
                return;
              }
              setBusy(true);
              try {
                const response = await client.request<{
                  authorization_url: string;
                }>("auth/sso/start", "POST", { organization });
                window.location.assign(response.authorization_url);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Sign in with {sso.display_name}
          </button>
        )}
      </form>
    </main>
  );
}

function CreateWork({
  section,
  client,
  actor,
  caseId,
  onClose,
  onSave,
}: {
  section: string;
  client: OrgoClient;
  actor: Actor;
  caseId?: string;
  onClose(): void;
  onSave(): void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [workflowList, setWorkflowList] = useState<Row[]>([]);
  const key = useRef("");
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, []);
  useEffect(() => {
    if (section === "signals" && can(actor, "workflows:read"))
      void client
        .request<Row[]>("workflows")
        .then(setWorkflowList)
        .catch(() => {});
  }, [section, client, actor]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    const body: Row = {
      title: raw.title,
      description: raw.description,
      label: raw.label,
      severity: raw.severity,
      source: "manual",
    };
    if (section !== "signals" && raw.scope) {
      const selected = JSON.parse(String(raw.scope));
      body.access_scope_type = selected.type;
      body.access_scope_reference = selected.reference;
    }
    if (section !== "signals" && raw.access_scope_type) {
      body.access_scope_type = raw.access_scope_type;
      body.access_scope_reference = raw.access_scope_reference;
    }
    if (section !== "cases") {
      body.type = raw.type;
      body.category = raw.category;
      if (raw.case_id) body.case_id = raw.case_id;
    }
    if (section === "tasks") body.priority = raw.priority;
    if (raw.workflow_version_id)
      body.workflow_version_id = raw.workflow_version_id;
    setBusy(true);
    setError("");
    try {
      await client.request(section, "POST", body, key.current);
      onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create");
      if (e instanceof ApiError && e.code !== "NETWORK_ERROR")
        key.current = crypto.randomUUID();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel create-panel" aria-label="Create item">
      <div className="panel-heading">
        <h2>
          {section === "cases"
            ? "New case"
            : section === "signals"
              ? "New signal"
              : "New task"}
        </h2>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <form className="form-grid" onSubmit={submit}>
        {section !== "signals" &&
          (actor.permissions.includes("*") ||
            actor.permissions.includes("work:write")) && (
            <>
              <label>
                Scope type
                <select name="access_scope_type">
                  <option value="">Organization</option>
                  {["team", "location", "unit", "custom"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Scope reference
                <input name="access_scope_reference" maxLength={200} />
              </label>
            </>
          )}
        {section !== "signals" && !!actor.workGrants?.length && (
          <label>
            Scope
            <select
              name="scope"
              required={
                !actor.permissions.includes("*") &&
                !actor.permissions.includes("work:write")
              }
            >
              <option value="">Entire organization</option>
              {actor.workGrants
                .filter((g) => g.permissions.includes("work:write"))
                .map((g, index) => (
                  <option
                    key={index}
                    value={JSON.stringify({
                      type: g.scope_type,
                      reference: g.scope_reference,
                    })}
                  >
                    {g.scope_type} : {g.scope_reference}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="wide">
          Title
          <input name="title" required maxLength={500} autoFocus />
        </label>
        <label className="wide">
          Description
          <textarea name="description" rows={3} maxLength={20000} />
        </label>
        <label>
          Label
          <input
            name="label"
            defaultValue="1.11"
            required
            pattern="[1-9][0-9]*\.[1-9][1-5](\.[A-Za-z0-9]+)*"
          />
        </label>
        <label>
          Severity
          <select name="severity" defaultValue="MODERATE">
            {["MINOR", "MODERATE", "MAJOR", "CRITICAL"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {section !== "cases" && (
          <>
            <label>
              Type
              <input name="type" defaultValue="general" required />
            </label>
            <label>
              Category
              <select name="category">
                {[
                  "request",
                  "incident",
                  "update",
                  "report",
                  "distribution",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Associated case (ID, optional)
              <input name="case_id" defaultValue={caseId} />
            </label>
          </>
        )}
        {section === "tasks" && (
          <label>
            Priority
            <select name="priority" defaultValue="MEDIUM">
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {section === "signals" && workflowList.length > 0 && (
          <label className="wide">
            Processing
            <select name="workflow_version_id">
              <option value="">Keep for triage</option>
              {workflowList.map((w) => (
                <optgroup key={rowId(w)} label={str(w.name)}>
                  {rows(w.versions).map((v) => (
                    <option key={rowId(v)} value={rowId(v)}>
                      Version {str(v.version)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <div className="wide">
          <ErrorMessage error={error} />
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Create"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Detail({
  row,
  section,
  client,
  actor,
  onChange,
  navigate,
  onClose,
}: {
  row: Row;
  section: string;
  client: OrgoClient;
  actor: Actor;
  onChange(): void;
  navigate(path: string): void;
  onClose(): void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [users, setUsers] = useState<Row[]>([]),
    [workflows, setWorkflows] = useState<Row[]>([]);
  const type = section === "my-work" ? "tasks" : section;
  useEffect(() => {
    if (can(actor, "people:read"))
      void client
        .request<Row[]>("users")
        .then(setUsers)
        .catch(() => {});
    if (type === "signals" && can(actor, "workflows:read"))
      void client
        .request<Row[]>("workflows")
        .then(setWorkflows)
        .catch(() => {});
  }, [actor, client, type]);
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await client.request(path, method, body);
      onChange();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to complete action");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const endpoint = `${type}/${rowId(row)}`;
  return (
    <aside className="panel detail">
      <div className="panel-heading">
        <span>
          {type === "cases"
            ? "Case"
            : type === "signals"
              ? "Signal"
              : "Task"}
        </span>
        <button onClick={onClose} aria-label="Close details">
          ×
        </button>
      </div>
      <div className="detail-body">
        <Badge value={row.status} />
        <h2>{str(row.title)}</h2>
        <p className="description">
          {str(row.description) || "No description."}
        </p>
        <div className="facts">
          <span>
            Label<strong>{str(row.label)}</strong>
          </span>
          <span>
            Severity<strong>{str(row.severity)}</strong>
          </span>
          <span>
            Created
            <strong>
              <DateText value={row.created_at ?? row.received_at} />
            </strong>
          </span>
        </div>
        <ErrorMessage error={error} />
        {type !== "signals" &&
          can(actor, "work:write") &&
          (states[str(row.status)] ?? []).length > 0 && (
            <div className="transition-actions">
              {states[str(row.status)].map((status) => (
                <button
                  disabled={busy}
                  key={status}
                  onClick={() =>
                    void mutate(`${endpoint}/status`, "PATCH", {
                      status,
                      revision: row.revision,
                    })
                  }
                >
                  {stateName[status]}
                </button>
              ))}
            </div>
          )}
        {type === "cases" && (
          <>
            <div className="section-heading">
              <h3>Related tasks</h3>
              {can(actor, "work:write") && (
                <button onClick={() => setCreating(!creating)}>
                  + Add
                </button>
              )}
            </div>
            {creating && (
              <CreateWork
                section="tasks"
                client={client}
                actor={actor}
                caseId={rowId(row)}
                onClose={() => setCreating(false)}
                onSave={() => {
                  setCreating(false);
                  onChange();
                }}
              />
            )}
            {rows(row.tasks).length ? (
              rows(row.tasks).map((task) => (
                <button
                  className="relation"
                  key={rowId(task)}
                  onClick={() => navigate(`tasks/${rowId(task)}`)}
                >
                  <span>{str(task.title)}</span>
                  <Badge value={task.status} />
                </button>
              ))
            ) : (
              <Empty>No related tasks.</Empty>
            )}
            <h3>Signals</h3>
            {rows(row.signals).map((signal) => (
              <button
                className="relation"
                key={rowId(signal)}
                onClick={() => navigate(`signals/${rowId(signal)}`)}
              >
                {str(signal.title)}
                <Badge value={signal.status} />
              </button>
            ))}
            <h3>External operations</h3>
            {rows(row.operations).map((op) => (
              <div className="relation" key={rowId(op)}>
                <span>
                  {str(op.provider)} · {str(op.operation)}
                </span>
                <Badge value={op.status} />
              </div>
            ))}
          </>
        )}
        {type === "tasks" && (
          <>
            {Boolean(row.case_id) && (
              <button
                className="relation"
                onClick={() => navigate(`cases/${str(row.case_id)}`)}
              >
                Open associated case ↗
              </button>
            )}
            {can(actor, "work:assign") && users.length > 0 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = new FormData(e.currentTarget).get("owner");
                  void mutate(`${endpoint}/assignment`, "PATCH", {
                    owner_user_id: value || null,
                    revision: row.revision,
                  });
                }}
              >
                <label>
                  Assignee
                  <select
                    key={str(row.owner_user_id)}
                    name="owner"
                    defaultValue={str(row.owner_user_id)}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={rowId(u)} value={rowId(u)}>
                        {str(u.display_name)}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy}>Assign</button>
              </form>
            )}
            <h3>Comments</h3>
            {rows(row.comments).map((c) => (
              <p className="comment" key={rowId(c)}>
                {str(c.body)}
                <small>
                  <DateText value={c.created_at} />
                </small>
              </p>
            ))}
            {can(actor, "work:comment") && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  void mutate(`${endpoint}/comments`, "POST", {
                    body: new FormData(form).get("body"),
                    visibility: "internal_only",
                  }).then((ok) => {
                    if (ok) form.reset();
                  });
                }}
              >
                <label>
                  Add a comment
                  <textarea name="body" required maxLength={20000} rows={3} />
                </label>
                <button disabled={busy}>Comment</button>
              </form>
            )}
          </>
        )}
        {type === "signals" &&
          row.status === "RECEIVED" &&
          can(actor, "workflows:execute") &&
          workflows.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(`${endpoint}/process`, "POST", {
                  workflow_version_id: new FormData(e.currentTarget).get(
                    "version",
                  ),
                });
              }}
            >
              <label>
                Version to run
                <select name="version" required>
                  {workflows.flatMap((w) =>
                    rows(w.versions).map((v) => (
                      <option key={rowId(v)} value={rowId(v)}>
                        {str(w.name)} · v{str(v.version)}
                      </option>
                    )),
                  )}
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Run processing
              </button>
            </form>
          )}
        {type === "signals" && Boolean(row.case_id) && (
          <button
            className="relation"
            onClick={() => navigate(`cases/${str(row.case_id)}`)}
          >
            Open associated case ↗
          </button>
        )}
        {(type === "tasks" || type === "cases") && (
          <EvidencePanel
            key={rowId(row)}
            client={client}
            actor={actor}
            type={type === "tasks" ? "task" : "case"}
            id={rowId(row)}
          />
        )}
        {type === "signals" && row.source === "email" && (
          <EmailEvidence client={client} id={rowId(row)} />
        )}
        {(type === "tasks" || type === "cases") && can(actor, "work:write") && (
          <EditWork
            client={client}
            row={row}
            type={type === "tasks" ? "task" : "case"}
            onChange={onChange}
          />
        )}
        <h3>Recent history</h3>
        {rows(row.timeline).map((event) => (
          <div className="timeline-event" key={rowId(event)}>
            <strong>{str(event.event_type)}</strong>
            <small>
              <DateText value={event.created_at} />
            </small>
          </div>
        ))}
        <details>
          <summary>References and metadata</summary>
          <p className="mono">{rowId(row)}</p>
          <pre>
            {JSON.stringify(row.metadata ?? row.payload ?? {}, null, 2)}
          </pre>
        </details>
      </div>
    </aside>
  );
}

const example = JSON.stringify(
  {
    rules: [
      {
        id: "open-work",
        enabled: true,
        match: { source: "API", category: "incident" },
        actions: [
          {
            type: "CREATE_CASE",
            input: {
              title: "$signal.title",
              description: "$signal.description",
              label: "$signal.label",
              severity: "$signal.severity",
            },
          },
          {
            type: "CREATE_TASK",
            input: {
              case_id: "$case",
              title: "$signal.title",
              label: "$signal.label",
              type: "$signal.type",
              category: "$signal.category",
            },
          },
        ],
      },
    ],
  },
  null,
  2,
);
function WorkflowAdmin({
  client,
  actor,
  workflows,
  onSave,
}: {
  client: OrgoClient;
  actor: Actor;
  workflows: Row[];
  onSave(): void;
}) {
  const [content, setContent] = useState(example),
    [error, setError] = useState(""),
    [output, setOutput] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="workflow-grid">
      <section className="panel padded">
        <h2>Published versions</h2>
        {workflows.length ? (
          workflows.map((w) => (
            <div key={rowId(w)}>
              <h3>{str(w.name)}</h3>
              {rows(w.versions).map((v) => (
                <div className="version-row" key={rowId(v)}>
                  <span>
                    Version {str(v.version)}
                    <small className="mono">
                      {str(v.content_hash).slice(0, 12)}
                    </small>
                  </span>
                  <button
                    onClick={() =>
                      setContent(JSON.stringify(v.content, null, 2))
                    }
                  >
                    Read
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const result = await client.request(
                          `workflow-versions/${rowId(v)}/simulate`,
                          "POST",
                          {
                            source: "API",
                            category: "incident",
                            title: "Test incident",
                          },
                        );
                        setOutput(JSON.stringify(result, null, 2));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Simulate
                  </button>
                </div>
              ))}
            </div>
          ))
        ) : (
          <Empty>No published workflow.</Empty>
        )}
        {output && (
          <>
            <h3>No-side-effect simulation</h3>
            <pre>{output}</pre>
          </>
        )}
      </section>
      <section className="panel padded">
        <h2>
          {can(actor, "workflows:write")
            ? "Publish a version"
            : "Read a version"}
        </h2>
        <p>
          A new publication never modifies existing instances.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const code = new FormData(e.currentTarget).get("code");
              await client.request(
                `workflows/${encodeURIComponent(str(code))}/versions`,
                "POST",
                JSON.parse(content),
              );
              onSave();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Code
            <input
              name="code"
              required
              defaultValue="intake-incidents"
              pattern="[a-z0-9][a-z0-9_-]*"
            />
          </label>
          <label>
            Rules (JSON)
            <textarea
              className="code-editor"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={22}
              spellCheck={false}
            />
          </label>
          <ErrorMessage error={error} />
          {can(actor, "workflows:write") && (
            <button className="primary" disabled={busy}>
              {busy ? "Publishing…" : "Publish version"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
function Insights({
  client,
  version,
}: {
  client: OrgoClient;
  version: number;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    client
      .request<Row>("insights/overview")
      .then((v) => {
        if (!cancelled) setData(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [client, version]);
  return (
    <>
      <ErrorMessage error={error} />
      {!data ? (
        <Empty>Loading insights…</Empty>
      ) : (
        <>
          <div className="metrics">
            <div className="metric">
              <span>Tasks</span>
              <strong>
                {rows(data.tasks).reduce((n, r) => n + Number(r.count), 0)}
              </strong>
            </div>
            <div className="metric">
              <span>Cases</span>
              <strong>
                {rows(data.cases).reduce((n, r) => n + Number(r.count), 0)}
              </strong>
            </div>
            <div className="metric attention">
              <span>Overdue</span>
              <strong>{str(data.overdue)}</strong>
            </div>
          </div>
          <div className="workflow-grid">
            {["tasks", "cases"].map((kind) => (
              <section className="panel padded" key={kind}>
                <h2>
                  {kind === "tasks" ? "Tasks by status" : "Cases by status"}
                </h2>
                {rows(data[kind]).map((r) => (
                  <div className="relation" key={str(r.status)}>
                    <Badge value={r.status} />
                    <strong>{str(r.count)}</strong>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
function Settings({ client, actor }: { client: OrgoClient; actor: Actor }) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    client
      .request<Row | null>("config/profile")
      .then(setData)
      .catch((e) => setError(e.message));
  }, [client]);
  return (
    <section className="panel padded">
      <h2>Organization profile</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const raw = new FormData(e.currentTarget);
          try {
            const result = await client.request<Row>("config/profile", "PUT", {
              version: Number(data?.version ?? 0),
              profile_code: raw.get("code"),
              reactivity_profile: {
                default_seconds: Number(raw.get("seconds")),
              },
              transparency_profile: data?.transparency_profile ?? {},
              pattern_sensitivity_profile:
                data?.pattern_sensitivity_profile ?? {},
              retention_profile: data?.retention_profile ?? {},
            });
            setData(result);
            setMessage("Profile saved.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        key={str(data?.version)}
      >
        <label>
          Profile code
          <input
            name="code"
            required
            defaultValue={str(data?.profile_code) || "general"}
          />
        </label>
        <label>
          Default response time (seconds)
          <input
            name="seconds"
            type="number"
            min={1}
            max={31536000}
            required
            defaultValue={Number(
              (data?.reactivity_profile as Row)?.default_seconds ?? 43200,
            )}
          />
        </label>
        <ErrorMessage error={error} />
        <p role="status">{message}</p>
        {can(actor, "config:write") && (
          <button className="primary">Save</button>
        )}
      </form>
    </section>
  );
}
