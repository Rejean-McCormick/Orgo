import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EvidencePanel } from "./Extensions";
import { Actor, can, OrgoClient, Row, rowId, rows, str } from "./api";

export const interactionSections = [
  "today",
  "workrooms",
  "intake",
  "team",
  "situation",
] as const;

type Navigate = (path: string) => void;
type Props = {
  client: OrgoClient;
  actor: Actor;
  navigate: Navigate;
  query: string;
  path: string[];
  version: number;
  reload(): void;
};

type WorkroomMode = "standard" | "investigation" | "project" | "incident" | "review";
type WorkroomLens =
  | "overview"
  | "actions"
  | "plan"
  | "decisions"
  | "evidence"
  | "people"
  | "timeline"
  | "review";

type DecisionEntry = {
  id: string;
  question: string;
  result: string;
  rationale: string;
  created_at: string;
  actor_user_id: string | null;
};

type ReviewEntry = {
  summary: string;
  worked: string;
  change: string;
  reviewed_at: string;
  reviewed_by: string | null;
};

type PlanStepDraft =
  | { kind: "approval"; title: string; permission: string }
  | { kind: "timer"; title: string; seconds: number }
  | {
      kind: "integration";
      title: string;
      provider: "kristal" | "konnaxion" | "architect" | "koa";
      operation: string;
    };

const terminalTask = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const statusLabel: Record<string, string> = {
  PENDING: "To do",
  IN_PROGRESS: "In progress",
  ON_HOLD: "Waiting",
  ESCALATED: "Escalated",
  COMPLETED: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  archived: "Archived",
  RECEIVED: "New",
  PROCESSED: "Processed",
  REJECTED: "Rejected",
  RUNNING: "Running",
  WAITING_EXTERNAL: "Waiting for external system",
  WAITING_HUMAN: "Waiting for approval",
  WAITING_TIMER: "Waiting",
  BLOCKED: "Blocked",
  SUCCEEDED: "Succeeded",
  DEAD: "Needs retry",
};

function text(value: unknown) {
  return value == null ? "" : String(value);
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function date(value: unknown) {
  if (!value) return "—";
  const d = new Date(text(value));
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}
function relative(value: unknown) {
  if (!value) return "";
  const d = new Date(text(value)).getTime();
  if (!Number.isFinite(d)) return "";
  const minutes = Math.round((d - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 36) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
function Status({ value }: { value: unknown }) {
  const v = text(value);
  return <span className={`badge state-${v.toLowerCase()}`}>{(statusLabel[v] ?? v) || "—"}</span>;
}
function Severity({ value }: { value: unknown }) {
  const v = text(value).toLowerCase();
  if (!v) return null;
  return <span className={`severity severity-${v}`}>{v}</span>;
}
function ErrorText({ error }: { error: string }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}
function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="oim-empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
function Loading() {
  return <div className="oim-loading" aria-live="polite">Loading…</div>;
}
function PageTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading oim-page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}
function modeOf(row: Row): WorkroomMode {
  const metadata = object(row.metadata);
  const explicit = text(metadata.oim_mode).toLowerCase();
  if (["standard", "investigation", "project", "incident", "review"].includes(explicit)) return explicit as WorkroomMode;
  const haystack = `${text(row.title)} ${text(row.description)} ${list(row.tags).join(" ")}`.toLowerCase();
  if (text(row.severity).toLowerCase() === "critical" || /incident|outage|emergency|crisis/.test(haystack)) return "incident";
  if (/investigat|root cause|complaint|anomal|fault|problem/.test(haystack)) return "investigation";
  if (/project|deliver|program|rollout|implementation/.test(haystack)) return "project";
  if (row.status === "resolved") return "review";
  return "standard";
}
function modeName(mode: WorkroomMode) {
  return ({ standard: "Standard", investigation: "Investigation", project: "Project / Delivery", incident: "Incident", review: "Review" } as const)[mode];
}
function eventName(value: unknown) {
  const raw = text(value);
  if (!raw) return "Update";
  return raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}
function priorityRank(row: Row) {
  const priority = text(row.priority).toUpperCase();
  const state = text(row.status);
  const due = row.due_at ? new Date(text(row.due_at)).getTime() : Number.POSITIVE_INFINITY;
  const dueRank = Number.isFinite(due) && due < Date.now() ? 0 : Number.isFinite(due) && due < Date.now() + 86400000 ? 1 : 2;
  return [state === "ESCALATED" ? 0 : 1, ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as Record<string, number>)[priority] ?? 4, dueRank, due];
}
function compareTasks(a: Row, b: Row) {
  const aa = priorityRank(a), bb = priorityRank(b);
  for (let i = 0; i < aa.length; i += 1) {
    const delta = Number(aa[i]) - Number(bb[i]);
    if (delta) return delta;
  }
  return text(a.title).localeCompare(text(b.title));
}
function ActionCard({ task, navigate, compact = false, onTransition }: { task: Row; navigate: Navigate; compact?: boolean; onTransition?: (task: Row, status: string) => void }) {
  const status = text(task.status);
  const next = status === "PENDING" ? "IN_PROGRESS" : status === "ON_HOLD" || status === "ESCALATED" ? "IN_PROGRESS" : status === "IN_PROGRESS" ? "COMPLETED" : "";
  const nextLabel = next === "IN_PROGRESS" ? (status === "PENDING" ? "Start" : "Resume") : next === "COMPLETED" ? "Complete" : "";
  return (
    <article className={`action-card ${compact ? "compact" : ""}`}>
      <div className="action-card-main">
        <div className="oim-card-kicker">
          <Status value={task.status} />
          {task.priority ? <span>{text(task.priority).toLowerCase()} priority</span> : null}
          {task.due_at ? <span className={new Date(text(task.due_at)).getTime() < Date.now() ? "overdue" : ""}>Due {relative(task.due_at)}</span> : null}
        </div>
        <button className="oim-title-link" onClick={() => navigate(`tasks/${rowId(task)}`)}>{text(task.title) || "Untitled action"}</button>
        {!compact && text(task.description) ? <p>{text(task.description)}</p> : null}
      </div>
      <div className="action-card-actions">
        {next && onTransition ? <button className={next === "COMPLETED" ? "primary" : ""} onClick={() => onTransition(task, next)}>{nextLabel}</button> : null}
        <button onClick={() => navigate(`tasks/${rowId(task)}`)}>Open</button>
      </div>
    </article>
  );
}

export function InteractionSurface(props: Props & { section: string }) {
  switch (props.section) {
    case "today": return <TodaySurface {...props} />;
    case "workrooms": return <WorkroomsSurface {...props} />;
    case "intake": return <IntakeSurface {...props} />;
    case "team": return <TeamSurface {...props} />;
    case "situation": return <SituationSurface {...props} />;
    default: return null;
  }
}

function TodaySurface({ client, actor, navigate, query, version }: Props) {
  const [tasks, setTasks] = useState<Row[]>([]), [notifications, setNotifications] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const taskPromise = client.request<Row | Row[]>("tasks?mine=true&limit=100&offset=0");
    const notificationPromise = can(actor, "notifications:read") ? client.request<Row[]>("notifications?status=unread&limit=20&offset=0").catch(() => []) : Promise.resolve([] as Row[]);
    void Promise.all([taskPromise, notificationPromise]).then(([taskResult, notificationResult]) => {
      if (cancelled) return;
      setTasks(Array.isArray(taskResult) ? taskResult : rows(taskResult.items));
      setNotifications(notificationResult);
    }).catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Unable to load Today")).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [client, actor, version]);
  const visible = useMemo(() => tasks.filter((t) => !terminalTask.has(text(t.status))).filter((t) => !query || `${text(t.title)} ${text(t.label)} ${text(t.description)}`.toLowerCase().includes(query.toLowerCase())).sort(compareTasks), [tasks, query]);
  const waiting = visible.filter((t) => t.status === "ON_HOLD"), escalated = visible.filter((t) => t.status === "ESCALATED"), due = visible.filter((t) => t.due_at && new Date(text(t.due_at)).getTime() < Date.now() + 86400000);
  return (
    <>
      <PageTitle eyebrow="Personal" title="Today" description="The work that needs your attention now." />
      <ErrorText error={error} />
      {loading ? <Loading /> : <>
        <div className="oim-metrics">
          <Metric value={visible.length} label="Active actions" />
          <Metric value={due.length} label="Due / overdue" emphasis={due.length > 0} />
          <Metric value={waiting.length} label="Waiting" />
          <Metric value={escalated.length} label="Escalated" emphasis={escalated.length > 0} />
        </div>
        <div className="oim-two-column">
          <section className="panel oim-section-panel">
            <div className="oim-section-heading"><div><p className="eyebrow">Priority</p><h2>Needs attention</h2></div><button onClick={() => navigate("my-work")}>All my work</button></div>
            {visible.length ? <div className="action-list">{visible.slice(0, 10).map((task) => <ActionCard key={rowId(task)} task={task} navigate={navigate} />)}</div> : <EmptyState title="Nothing needs your attention">Assigned active Actions will appear here.</EmptyState>}
          </section>
          <section className="panel oim-section-panel">
            <div className="oim-section-heading"><div><p className="eyebrow">Updates</p><h2>Unread</h2></div></div>
            {notifications.length ? <div className="notification-list">{notifications.slice(0, 8).map((n) => <article key={rowId(n)} className="notification-card"><strong>{text(n.subject) || text(n.title) || "Update"}</strong><p>{text(n.body) || text(n.message)}</p><small>{date(n.created_at)}</small></article>)}</div> : <EmptyState title="You're up to date">No unread notifications.</EmptyState>}
          </section>
        </div>
      </>}
    </>
  );
}
function Metric({ value, label, emphasis = false }: { value: number; label: string; emphasis?: boolean }) {
  return <div className={`oim-metric ${emphasis ? "emphasis" : ""}`}><strong>{value}</strong><span>{label}</span></div>;
}

function WorkroomsSurface(props: Props) {
  const id = props.path[1];
  if (id) return <WorkroomSurface {...props} id={id} lens={(props.path[2] as WorkroomLens | undefined) ?? "overview"} />;
  return <WorkroomList {...props} />;
}

function WorkroomList({ client, actor, navigate, query, version, reload }: Props) {
  const [items, setItems] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setError("");
    const p = new URLSearchParams({ limit: "100", offset: "0", ...(query ? { search: query } : {}) });
    void client.request<Row>(`cases?${p}`).then((r) => setItems(rows(r.items))).catch((e) => setError(e instanceof Error ? e.message : "Unable to load Workrooms")).finally(() => setLoading(false));
  }, [client, query]);
  useEffect(load, [load, version]);
  return (
    <>
      <PageTitle eyebrow="Context" title="Workrooms" description="Shared operational context for situations that need coordinated work." actions={<>{can(actor, "work:write") ? <button className="primary" onClick={() => setCreating(!creating)}>+ New Workroom</button> : null}</>} />
      <ErrorText error={error} />
      {creating ? <NewWorkroom client={client} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load(); reload(); }} /> : null}
      {loading ? <Loading /> : items.length ? <div className="workroom-grid">{items.map((room) => <button key={rowId(room)} className={`workroom-card mode-${modeOf(room)}`} onClick={() => navigate(`workrooms/${rowId(room)}`)}><div className="workroom-card-top"><span className="mode-chip">{modeName(modeOf(room))}</span><Status value={room.status} /></div><h2>{text(room.title)}</h2><p>{text(room.description) || "No situation summary yet."}</p><div className="workroom-card-meta"><Severity value={room.severity} /><span>{text(room.label)}</span><span>Updated {relative(room.updated_at ?? room.created_at)}</span></div></button>)}</div> : <EmptyState title={query ? "No matching Workrooms" : "No Workrooms yet"}>{query ? "Try a different search." : "Create a Workroom when a situation needs durable coordination."}</EmptyState>}
    </>
  );
}

function NewWorkroom({ client, onCancel, onSaved }: { client: OrgoClient; onCancel(): void; onSaved(): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const room = await client.request<Row>("cases", "POST", { title: raw.title, description: raw.description, label: raw.label, severity: raw.severity, source: "manual" });
      const mode = text(raw.mode);
      if (mode && mode !== "standard") await client.request(`cases/${rowId(room)}`, "PATCH", { revision: Number(room.revision ?? 0), metadata: { oim_mode: mode } });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create Workroom"); }
    finally { setBusy(false); }
  }
  return <section className="panel oim-form-panel"><div className="oim-section-heading"><div><p className="eyebrow">New context</p><h2>Create Workroom</h2></div><button onClick={onCancel}>Cancel</button></div><form className="oim-form" onSubmit={submit}><label className="wide">Situation / title<input name="title" required autoFocus maxLength={500} /></label><label className="wide">What is happening?<textarea name="description" rows={4} maxLength={20000} /></label><label>Mode<select name="mode" defaultValue="standard"><option value="standard">Standard</option><option value="investigation">Investigation</option><option value="project">Project / Delivery</option><option value="incident">Incident</option></select></label><label>Severity<select name="severity" defaultValue="MODERATE"><option>MINOR</option><option>MODERATE</option><option>MAJOR</option><option>CRITICAL</option></select></label><label>Label<input name="label" defaultValue="1.11" required pattern="[1-9][0-9]*\.[1-9][1-5](\.[A-Za-z0-9]+)*" /></label><div className="wide"><ErrorText error={error} /><button className="primary" disabled={busy}>{busy ? "Creating…" : "Create Workroom"}</button></div></form></section>;
}

function WorkroomSurface({ client, actor, navigate, version, reload, id, lens }: Props & { id: string; lens: WorkroomLens }) {
  const validLens: WorkroomLens = ["overview", "actions", "plan", "decisions", "evidence", "people", "timeline", "review"].includes(lens) ? lens : "overview";
  const [room, setRoom] = useState<Row | null>(null), [processes, setProcesses] = useState<Row[]>([]), [users, setUsers] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const load = useCallback(() => {
    setLoading(true); setError("");
    const roomRequest = client.request<Row>(`cases/${encodeURIComponent(id)}`);
    const processRequest = can(actor, "workflows:read") ? client.request<Row>("processes?limit=100&offset=0").then((r) => rows(r.items).filter((p) => text(p.subject_type) === "case" && text(p.subject_id) === id)).catch(() => []) : Promise.resolve([] as Row[]);
    const usersRequest = can(actor, "people:read") ? client.request<Row[]>("users").catch(() => []) : Promise.resolve([] as Row[]);
    void Promise.all([roomRequest, processRequest, usersRequest]).then(([r, p, u]) => { setRoom(r); setProcesses(p); setUsers(u); }).catch((e) => setError(e instanceof Error ? e.message : "Unable to load Workroom")).finally(() => setLoading(false));
  }, [client, actor, id]);
  useEffect(load, [load, version]);
  if (loading && !room) return <Loading />;
  if (!room) return <><PageTitle eyebrow="Workroom" title="Unavailable" description="This Workroom could not be loaded." /><ErrorText error={error} /></>;
  const currentRoom = room;
  const mode = modeOf(currentRoom), tasks = rows(currentRoom.tasks), active = tasks.filter((t) => !terminalTask.has(text(t.status))), blockers = tasks.filter((t) => ["ON_HOLD", "ESCALATED", "FAILED"].includes(text(t.status))), decisions = list(object(currentRoom.metadata).oim_decisions).filter((d): d is DecisionEntry => Boolean(d && typeof d === "object")) as DecisionEntry[];
  const lenses: { id: WorkroomLens; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" }, { id: "actions", label: "Actions", count: active.length }, { id: "plan", label: "Plan", count: processes.length }, { id: "decisions", label: "Decisions", count: decisions.length + processes.filter((p) => p.status === "WAITING_HUMAN").length }, { id: "evidence", label: "Evidence", count: rows(currentRoom.signals).length }, { id: "people", label: "People" }, { id: "timeline", label: "Timeline", count: rows(currentRoom.timeline).length }, { id: "review", label: "Review" },
  ];
  async function patch(body: Row) {
    try { await client.request(`cases/${id}`, "PATCH", { revision: currentRoom.revision, ...body }); load(); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to update Workroom"); }
  }
  async function changeStatus(status: string) {
    try { await client.request(`cases/${id}/status`, "PATCH", { revision: currentRoom.revision, status }); load(); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to change status"); }
  }
  const nextStatuses = text(currentRoom.status) === "open" ? ["in_progress", "resolved"] : text(currentRoom.status) === "in_progress" ? ["resolved"] : text(currentRoom.status) === "resolved" ? ["in_progress", "archived"] : [];
  return (
    <div className={`workroom-page workroom-mode-${mode}`}>
      <button className="back-link" onClick={() => navigate("workrooms")}>← Workrooms</button>
      <section className="workroom-hero">
        <div className="workroom-hero-main"><div className="oim-card-kicker"><span className="mode-chip">{modeName(mode)}</span><Status value={currentRoom.status} /><Severity value={currentRoom.severity} /></div><h1>{text(currentRoom.title)}</h1><p>{text(currentRoom.description) || "No situation summary yet."}</p><div className="workroom-hero-meta"><span>Label {text(currentRoom.label)}</span><span>Updated {date(currentRoom.updated_at ?? currentRoom.created_at)}</span>{currentRoom.access_scope_type ? <span>Scoped: {text(currentRoom.access_scope_type)} · {text(currentRoom.access_scope_reference)}</span> : <span>Organization scope</span>}</div></div>
        <div className="workroom-hero-actions">{can(actor, "work:write") ? <><label>Mode<select value={mode} onChange={(e: { target: { value: string } }) => void patch({ metadata: { oim_mode: e.target.value } })}><option value="standard">Standard</option><option value="investigation">Investigation</option><option value="project">Project / Delivery</option><option value="incident">Incident</option><option value="review">Review</option></select></label>{nextStatuses.map((s) => <button key={s} className={s === "resolved" ? "primary" : ""} onClick={() => void changeStatus(s)}>{s === "in_progress" ? "Start / reopen" : s === "resolved" ? "Resolve" : "Archive"}</button>)}</> : null}</div>
      </section>
      <ErrorText error={error} />
      {mode === "incident" ? <div className="incident-strip"><div><strong>{active.filter((t) => text(t.priority) === "CRITICAL" || text(t.status) === "ESCALATED").length}</strong><span>Critical actions</span></div><div><strong>{active.length}</strong><span>Open actions</span></div><div><strong>{blockers.length}</strong><span>Blockers</span></div><div><strong>{rows(currentRoom.signals).length}</strong><span>Signals</span></div></div> : null}
      <nav className="workroom-tabs" aria-label="Workroom views">{lenses.map((item) => <button key={item.id} className={validLens === item.id ? "active" : ""} onClick={() => navigate(`workrooms/${id}/${item.id}`)}>{item.label}{item.count ? <span>{item.count}</span> : null}</button>)}</nav>
      <div className="workroom-lens">
        {validLens === "overview" ? <OverviewLens room={currentRoom} tasks={tasks} processes={processes} navigate={navigate} mode={mode} /> : null}
        {validLens === "actions" ? <ActionsLens room={currentRoom} tasks={tasks} client={client} actor={actor} navigate={navigate} onChanged={() => { load(); reload(); }} /> : null}
        {validLens === "plan" ? <PlanLens room={currentRoom} processes={processes} client={client} actor={actor} onChanged={() => { load(); reload(); }} /> : null}
        {validLens === "decisions" ? <DecisionsLens room={currentRoom} processes={processes} decisions={decisions} client={client} actor={actor} onChanged={() => { load(); reload(); }} /> : null}
        {validLens === "evidence" ? <EvidenceLens room={currentRoom} client={client} actor={actor} navigate={navigate} /> : null}
        {validLens === "people" ? <PeopleLens tasks={tasks} users={users} navigate={navigate} /> : null}
        {validLens === "timeline" ? <TimelineLens room={currentRoom} /> : null}
        {validLens === "review" ? <ReviewLens room={currentRoom} client={client} actor={actor} navigate={navigate} onChanged={() => { load(); reload(); }} /> : null}
      </div>
    </div>
  );
}

function OverviewLens({ room, tasks, processes, navigate, mode }: { room: Row; tasks: Row[]; processes: Row[]; navigate: Navigate; mode: WorkroomMode }) {
  const active = tasks.filter((t) => !terminalTask.has(text(t.status))).sort(compareTasks), blockers = active.filter((t) => ["ON_HOLD", "ESCALATED"].includes(text(t.status))), timeline = rows(room.timeline), signals = rows(room.signals), operations = rows(room.operations);
  const objective = text(object(room.metadata).objective) || (mode === "incident" ? "Stabilize the situation and coordinate the next safe actions." : mode === "investigation" ? "Establish what happened, what is known, and what must be checked next." : mode === "project" ? "Coordinate delivery toward the intended outcome." : "Coordinate the situation through resolution.");
  return <div className="oim-two-column wide-left"><div className="oim-stack"><section className="panel oim-section-panel"><p className="eyebrow">Current context</p><h2>{mode === "incident" ? "Current situation" : mode === "investigation" ? "Investigation context" : "Situation"}</h2><p className="lead-copy">{text(room.description) || "No situation summary yet."}</p><div className="objective-box"><span>Objective</span><strong>{objective}</strong></div></section><section className="panel oim-section-panel"><div className="oim-section-heading"><div><p className="eyebrow">Execution</p><h2>Next actions</h2></div><button onClick={() => navigate(`workrooms/${rowId(room)}/actions`)}>All actions</button></div>{active.length ? <div className="action-list">{active.slice(0, 6).map((t) => <ActionCard key={rowId(t)} task={t} navigate={navigate} compact />)}</div> : <EmptyState title="No active Actions">This Workroom currently has no open Actions.</EmptyState>}</section></div><div className="oim-stack"><section className="panel oim-section-panel"><p className="eyebrow">At a glance</p><h2>Operational state</h2><div className="overview-stats"><Metric value={active.length} label="Open actions" /><Metric value={blockers.length} label="Blocked / waiting" emphasis={blockers.length > 0} /><Metric value={processes.length} label="Plans" /><Metric value={signals.length} label="Signals" /></div>{operations.length ? <p className="quiet-note">{operations.filter((o) => !["SUCCEEDED", "FAILED"].includes(text(o.status))).length} external operation(s) still active.</p> : null}</section><section className="panel oim-section-panel"><div className="oim-section-heading"><div><p className="eyebrow">Recent</p><h2>Latest updates</h2></div><button onClick={() => navigate(`workrooms/${rowId(room)}/timeline`)}>Timeline</button></div>{timeline.length ? <div className="timeline-list compact">{timeline.slice(0, 6).map((e) => <div className="timeline-row" key={rowId(e)}><span className="timeline-dot" /><div><strong>{eventName(e.event_type)}</strong><small>{date(e.created_at)}</small></div></div>)}</div> : <EmptyState title="No recorded updates" />}</section></div></div>;
}

function ActionsLens({ room, tasks, client, actor, navigate, onChanged }: { room: Row; tasks: Row[]; client: OrgoClient; actor: Actor; navigate: Navigate; onChanged(): void }) {
  const [creating, setCreating] = useState(false), [error, setError] = useState("");
  const active = tasks.filter((t) => !terminalTask.has(text(t.status))).sort(compareTasks), done = tasks.filter((t) => terminalTask.has(text(t.status))).sort(compareTasks);
  async function transition(task: Row, status: string) {
    setError(""); try { await client.request(`tasks/${rowId(task)}/status`, "PATCH", { status, revision: task.revision }); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update Action"); }
  }
  return <><div className="lens-heading"><div><p className="eyebrow">Execution</p><h2>Actions</h2><p>Canonical Tasks presented as executable Actions in context.</p></div>{can(actor, "work:write") ? <button className="primary" onClick={() => setCreating(!creating)}>+ Add Action</button> : null}</div><ErrorText error={error} />{creating ? <NewAction client={client} room={room} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); onChanged(); }} /> : null}<section className="panel oim-section-panel"><h3 className="section-title">Active</h3>{active.length ? <div className="action-list">{active.map((t) => <ActionCard key={rowId(t)} task={t} navigate={navigate} onTransition={(task, status) => void transition(task, status)} />)}</div> : <EmptyState title="No active Actions" />}</section>{done.length ? <section className="panel oim-section-panel"><h3 className="section-title">Completed / closed</h3><div className="action-list subdued">{done.slice(0, 20).map((t) => <ActionCard key={rowId(t)} task={t} navigate={navigate} compact />)}</div></section> : null}</>;
}
function NewAction({ client, room, onCancel, onSaved }: { client: OrgoClient; room: Row; onCancel(): void; onSaved(): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(""); const raw = Object.fromEntries(new FormData(e.currentTarget)); try { await client.request("tasks", "POST", { title: raw.title, description: raw.description, label: raw.label || room.label, type: raw.type, category: raw.category, priority: raw.priority, severity: raw.severity, case_id: rowId(room), ...(room.access_scope_type ? { access_scope_type: room.access_scope_type, access_scope_reference: room.access_scope_reference } : {}) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create Action"); } finally { setBusy(false); } }
  return <section className="panel oim-form-panel"><div className="oim-section-heading"><h2>New Action</h2><button onClick={onCancel}>Cancel</button></div><form className="oim-form" onSubmit={submit}><label className="wide">What needs to happen?<input name="title" required autoFocus maxLength={500} /></label><label className="wide">Context / expected result<textarea name="description" rows={3} maxLength={20000} /></label><label>Priority<select name="priority" defaultValue="MEDIUM"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label><label>Severity<select name="severity" defaultValue="MODERATE"><option>MINOR</option><option>MODERATE</option><option>MAJOR</option><option>CRITICAL</option></select></label><label>Type<input name="type" defaultValue="general" /></label><label>Category<input name="category" defaultValue="request" /></label><input type="hidden" name="label" value={text(room.label)} /><div className="wide"><ErrorText error={error} /><button className="primary" disabled={busy}>{busy ? "Creating…" : "Create Action"}</button></div></form></section>;
}

function PlanLens({ room, processes, client, actor, onChanged }: { room: Row; processes: Row[]; client: OrgoClient; actor: Actor; onChanged(): void }) {
  const [creating, setCreating] = useState(false), [error, setError] = useState("");
  return <><div className="lens-heading"><div><p className="eyebrow">Coordination</p><h2>Plan</h2><p>Running durable execution for this Workroom.</p></div>{can(actor, "workflows:execute") ? <button className="primary" onClick={() => setCreating(!creating)}>+ Start Plan</button> : null}</div><ErrorText error={error} />{creating ? <NewPlan room={room} client={client} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); onChanged(); }} onError={setError} /> : null}{processes.length ? <div className="plan-list">{processes.map((p) => <ProcessCard key={rowId(p)} process={p} client={client} actor={actor} onChanged={onChanged} onError={setError} />)}</div> : <EmptyState title="No Plan is running">Start a Plan when the Workroom needs explicit ordered waits, approvals, or external operations.</EmptyState>}</>;
}
function ProcessCard({ process, client, actor, onChanged, onError }: { process: Row; client: OrgoClient; actor: Actor; onChanged(): void; onError(message: string): void }) {
  const steps = list(process.plan).filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object")) as Record<string, unknown>[], index = Number(process.step_index ?? 0), current = steps[index];
  async function decide(decision: "approve" | "reject" | "retry" | "cancel", reason: string) { try { await client.request(`processes/${rowId(process)}/decision`, "POST", { revision: Number(process.revision ?? 0), decision, reason }); onChanged(); } catch (e) { onError(e instanceof Error ? e.message : "Unable to update Plan"); } }
  return <article className="panel process-card"><div className="process-head"><div><p className="eyebrow">Plan</p><h2>{text(process.title)}</h2></div><Status value={process.status} /></div><div className="process-progress"><span style={{ width: `${Math.min(100, steps.length ? (index / steps.length) * 100 : 0)}%` }} /></div><div className="process-current"><span>Current</span><strong>{current ? text(current.title) : process.status === "COMPLETED" ? "Completed" : "Finishing"}</strong>{current ? <small>{text(current.kind)}</small> : null}</div><ol className="plan-steps">{steps.map((step, i) => <li key={i} className={i < index ? "done" : i === index ? "current" : ""}><span>{i + 1}</span><div><strong>{text(step.title)}</strong><small>{text(step.kind)}</small></div></li>)}</ol>{process.error ? <p className="error">{text(process.error)}</p> : null}<div className="process-actions">{process.status === "WAITING_HUMAN" && can(actor, "workflows:execute") ? <><button className="primary" onClick={() => void decide("approve", "Approved in Workroom")}>Approve</button><button onClick={() => void decide("reject", "Rejected in Workroom")}>Reject</button></> : null}{process.status === "BLOCKED" && can(actor, "workflows:execute") ? <button onClick={() => void decide("retry", "Retry requested in Workroom")}>Retry</button> : null}{!["COMPLETED", "CANCELLED"].includes(text(process.status)) && can(actor, "workflows:execute") ? <button onClick={() => void decide("cancel", "Cancelled in Workroom")}>Cancel</button> : null}</div></article>;
}
function NewPlan({ room, client, onCancel, onSaved, onError }: { room: Row; client: OrgoClient; onCancel(): void; onSaved(): void; onError(message: string): void }) {
  const [title, setTitle] = useState("Operational plan"), [steps, setSteps] = useState<PlanStepDraft[]>([{ kind: "approval", title: "Approval", permission: "workflows:approve" }]), [busy, setBusy] = useState(false);
  function add(kind: PlanStepDraft["kind"]) { if (kind === "approval") setSteps((v) => [...v, { kind, title: "Approval", permission: "workflows:approve" }]); else if (kind === "timer") setSteps((v) => [...v, { kind, title: "Wait", seconds: 3600 }]); else setSteps((v) => [...v, { kind, title: "External operation", provider: "kristal", operation: "request" }]); }
  function update(index: number, patch: Record<string, unknown>) { setSteps((v) => v.map((step, i) => i === index ? ({ ...step, ...patch } as PlanStepDraft) : step)); }
  async function save() { setBusy(true); onError(""); try { const encoded = steps.map((step) => step.kind === "integration" ? { kind: "integration", title: step.title, request: { provider: step.provider, operation: step.operation, request: {} }, expect: {}, timeout_seconds: 86400 } : step); await client.request("processes", "POST", { title, subject_type: "case", subject_id: rowId(room), steps: encoded }); onSaved(); } catch (e) { onError(e instanceof Error ? e.message : "Unable to start Plan"); } finally { setBusy(false); } }
  return <section className="panel oim-form-panel plan-builder"><div className="oim-section-heading"><div><p className="eyebrow">Durable execution</p><h2>Start Plan</h2></div><button onClick={onCancel}>Cancel</button></div><label>Plan title<input value={title} onChange={(e: { target: { value: string } }) => setTitle(e.target.value)} /></label><div className="plan-builder-steps">{steps.map((step, i) => <div className="plan-builder-step" key={i}><span className="step-number">{i + 1}</span><div className="plan-builder-fields"><label>Step<input value={step.title} onChange={(e: { target: { value: string } }) => update(i, { title: e.target.value })} /></label><label>Kind<select value={step.kind} onChange={(e: { target: { value: string } }) => { const kind = e.target.value as PlanStepDraft["kind"]; const next: PlanStepDraft = kind === "approval" ? { kind, title: step.title, permission: "workflows:approve" } : kind === "timer" ? { kind, title: step.title, seconds: 3600 } : { kind, title: step.title, provider: "kristal", operation: "request" }; setSteps((v) => v.map((s, n) => n === i ? next : s)); }}><option value="approval">Approval</option><option value="timer">Wait</option><option value="integration">External operation</option></select></label>{step.kind === "approval" ? <label>Required permission<input value={step.permission} onChange={(e: { target: { value: string } }) => update(i, { permission: e.target.value })} /></label> : null}{step.kind === "timer" ? <label>Wait (seconds)<input type="number" min={1} max={2592000} value={step.seconds} onChange={(e: { target: { value: string } }) => update(i, { seconds: Number(e.target.value) })} /></label> : null}{step.kind === "integration" ? <><label>Provider<select value={step.provider} onChange={(e: { target: { value: string } }) => update(i, { provider: e.target.value })}><option value="kristal">Kristal</option><option value="konnaxion">Konnaxion</option><option value="architect">Architect</option><option value="koa">kOA</option></select></label><label>Operation<input value={step.operation} onChange={(e: { target: { value: string } }) => update(i, { operation: e.target.value })} /></label></> : null}</div><button aria-label={`Remove step ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps((v) => v.filter((_, n) => n !== i))}>×</button></div>)}</div><div className="plan-builder-add"><span>Add step</span><button onClick={() => add("approval")}>Approval</button><button onClick={() => add("timer")}>Wait</button><button onClick={() => add("integration")}>External</button></div><button className="primary" disabled={busy || !title.trim() || !steps.length} onClick={() => void save()}>{busy ? "Starting…" : "Start Plan"}</button></section>;
}

function DecisionsLens({ room, processes, decisions, client, actor, onChanged }: { room: Row; processes: Row[]; decisions: DecisionEntry[]; client: OrgoClient; actor: Actor; onChanged(): void }) {
  const [recording, setRecording] = useState(false), [error, setError] = useState(""); const pending = processes.filter((p) => p.status === "WAITING_HUMAN");
  return <><div className="lens-heading"><div><p className="eyebrow">Judgment</p><h2>Decisions</h2><p>Choices, rationale, authority, and the work that follows.</p></div>{can(actor, "work:write") ? <button className="primary" onClick={() => setRecording(!recording)}>+ Record Decision</button> : null}</div><ErrorText error={error} />{recording ? <DecisionForm room={room} client={client} actor={actor} decisions={decisions} onCancel={() => setRecording(false)} onSaved={() => { setRecording(false); onChanged(); }} onError={setError} /> : null}{pending.length ? <section className="panel oim-section-panel"><p className="eyebrow">Needs a decision</p><h2>Pending approvals</h2><div className="decision-list">{pending.map((p) => <div className="decision-card pending" key={rowId(p)}><Status value={p.status} /><strong>{text(p.title)}</strong><p>{text((list(p.plan)[Number(p.step_index ?? 0)] as Record<string, unknown> | undefined)?.title) || "Approval required"}</p><small>Use the Plan view to approve or reject this durable step.</small></div>)}</div></section> : null}<section className="panel oim-section-panel"><p className="eyebrow">Decision record</p><h2>Recorded decisions</h2>{decisions.length ? <div className="decision-list">{[...decisions].reverse().map((d) => <article className="decision-card" key={d.id}><div className="oim-card-kicker"><span>Decided</span><span>{date(d.created_at)}</span></div><h3>{d.question}</h3><strong className="decision-result">{d.result}</strong>{d.rationale ? <p>{d.rationale}</p> : null}</article>)}</div> : <EmptyState title="No formal decisions recorded">Record a Decision when the reasoning and consequences should remain explicit in this Workroom.</EmptyState>}</section></>;
}
function DecisionForm({ room, client, actor, decisions, onCancel, onSaved, onError }: { room: Row; client: OrgoClient; actor: Actor; decisions: DecisionEntry[]; onCancel(): void; onSaved(): void; onError(message: string): void }) {
  const [busy, setBusy] = useState(false); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); onError(""); const raw = Object.fromEntries(new FormData(e.currentTarget)); const next: DecisionEntry = { id: crypto.randomUUID(), question: text(raw.question), result: text(raw.result), rationale: text(raw.rationale), created_at: new Date().toISOString(), actor_user_id: actor.actorUserId }; try { await client.request(`cases/${rowId(room)}`, "PATCH", { revision: room.revision, metadata: { oim_decisions: [...decisions, next] } }); onSaved(); } catch (e) { onError(e instanceof Error ? e.message : "Unable to record Decision"); } finally { setBusy(false); } }
  return <section className="panel oim-form-panel"><div className="oim-section-heading"><h2>Record Decision</h2><button onClick={onCancel}>Cancel</button></div><form className="oim-form" onSubmit={submit}><label className="wide">Decision question<input name="question" required autoFocus placeholder="What are we deciding?" /></label><label className="wide">Decision / result<textarea name="result" required rows={3} placeholder="What was decided?" /></label><label className="wide">Rationale<textarea name="rationale" rows={4} placeholder="Why was this choice made?" /></label><div className="wide"><button className="primary" disabled={busy}>{busy ? "Recording…" : "Record Decision"}</button></div></form></section>;
}

function EvidenceLens({ room, client, actor, navigate }: { room: Row; client: OrgoClient; actor: Actor; navigate: Navigate }) {
  const signals = rows(room.signals), operations = rows(room.operations);
  return <><div className="lens-heading"><div><p className="eyebrow">Proof & context</p><h2>Evidence</h2><p>Material that informs the work or proves an outcome.</p></div></div><div className="oim-two-column"><section className="panel oim-section-panel"><p className="eyebrow">Files</p><h2>Attachments</h2><EvidencePanel client={client} actor={actor} type="case" id={rowId(room)} /></section><div className="oim-stack"><section className="panel oim-section-panel"><p className="eyebrow">Accepted input</p><h2>Signals</h2>{signals.length ? <div className="simple-list">{signals.map((s) => <button key={rowId(s)} onClick={() => navigate(`signals/${rowId(s)}`)}><span><strong>{text(s.title)}</strong><small>{text(s.source)} · {date(s.received_at)}</small></span><Status value={s.status} /></button>)}</div> : <EmptyState title="No linked Signals" />}</section><section className="panel oim-section-panel"><p className="eyebrow">External provenance</p><h2>Receipts / operations</h2>{operations.length ? <div className="simple-list">{operations.map((o) => <div className="simple-row" key={rowId(o)}><span><strong>{text(o.provider)} · {text(o.operation)}</strong><small>{text(o.external_reference) || text(o.correlation_id)}</small></span><Status value={o.status} /></div>)}</div> : <EmptyState title="No external operations" />}</section></div></div></>;
}

function PeopleLens({ tasks, users, navigate }: { tasks: Row[]; users: Row[]; navigate: Navigate }) {
  const map = new Map(users.map((u) => [rowId(u), text(u.display_name) || text(u.email) || rowId(u)])); const assignments = new Map<string, Row[]>(); for (const task of tasks) { const owner = text(task.owner_user_id) || "unassigned"; assignments.set(owner, [...(assignments.get(owner) ?? []), task]); }
  return <><div className="lens-heading"><div><p className="eyebrow">Accountability</p><h2>People</h2><p>Who currently owns or participates in the Workroom's Actions.</p></div></div><div className="people-grid">{[...assignments.entries()].map(([id, owned]) => <section className="panel person-card" key={id}><div className="avatar">{id === "unassigned" ? "?" : (map.get(id) ?? id).slice(0, 1).toUpperCase()}</div><div><h2>{id === "unassigned" ? "Unassigned" : map.get(id) ?? "Assigned person"}</h2><p>{owned.filter((t) => !terminalTask.has(text(t.status))).length} active · {owned.length} total Actions</p></div><div className="person-actions">{owned.filter((t) => !terminalTask.has(text(t.status))).slice(0, 5).map((t) => <button key={rowId(t)} onClick={() => navigate(`tasks/${rowId(t)}`)}>{text(t.title)}</button>)}</div></section>)}{!assignments.size ? <EmptyState title="No assignments yet" /> : null}</div></>;
}

function TimelineLens({ room }: { room: Row }) {
  const timeline = rows(room.timeline);
  return <><div className="lens-heading"><div><p className="eyebrow">Chronology</p><h2>Timeline</h2><p>A human-readable sequence of meaningful Workroom changes.</p></div></div>{timeline.length ? <section className="panel timeline-panel"><div className="timeline-list">{timeline.map((event) => <article className="timeline-row" key={rowId(event)}><span className="timeline-dot" /><div><strong>{eventName(event.event_type)}</strong><p>{text(event.actor_user_id) ? `Actor ${text(event.actor_user_id)}` : "System / integration"}</p><small>{date(event.created_at)}</small></div></article>)}</div></section> : <EmptyState title="No timeline events yet" />}</>;
}

function ReviewLens({ room, client, actor, navigate, onChanged }: { room: Row; client: OrgoClient; actor: Actor; navigate: Navigate; onChanged(): void }) {
  const saved = object(object(room.metadata).oim_review) as unknown as ReviewEntry; const [error, setError] = useState(""), [busy, setBusy] = useState(false); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(""); const raw = Object.fromEntries(new FormData(e.currentTarget)); try { await client.request(`cases/${rowId(room)}`, "PATCH", { revision: room.revision, metadata: { oim_review: { summary: raw.summary, worked: raw.worked, change: raw.change, reviewed_at: new Date().toISOString(), reviewed_by: actor.actorUserId } } }); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to save Review"); } finally { setBusy(false); } }
  return <><div className="lens-heading"><div><p className="eyebrow">Learn & improve</p><h2>Review</h2><p>Connect the chronology and outcome to concrete improvements.</p></div><button onClick={() => navigate(`workrooms/${rowId(room)}/actions`)}>Create corrective Action</button></div><section className="panel oim-form-panel"><form className="review-form" onSubmit={submit}><label>What happened?<textarea name="summary" rows={5} defaultValue={text(saved?.summary)} disabled={!can(actor, "work:write")} /></label><label>What worked?<textarea name="worked" rows={4} defaultValue={text(saved?.worked)} disabled={!can(actor, "work:write")} /></label><label>What should change?<textarea name="change" rows={4} defaultValue={text(saved?.change)} disabled={!can(actor, "work:write")} /></label>{saved?.reviewed_at ? <p className="quiet-note">Last reviewed {date(saved.reviewed_at)}</p> : null}<ErrorText error={error} />{can(actor, "work:write") ? <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save Review"}</button> : null}</form></section></>;
}

function IntakeSurface({ client, actor, navigate, query, version, reload }: Props) {
  const [signals, setSignals] = useState<Row[]>([]), [rooms, setRooms] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [reporting, setReporting] = useState(false);
  const load = useCallback(() => { setLoading(true); setError(""); const p = new URLSearchParams({ limit: "100", offset: "0", ...(query ? { search: query } : {}) }); void Promise.all([client.request<Row>(`signals?${p}`), can(actor, "work:read") ? client.request<Row>("cases?limit=100&offset=0").catch(() => ({ items: [] })) : Promise.resolve({ items: [] } as Row)]).then(([s, c]) => { setSignals(rows(s.items)); setRooms(rows(c.items)); }).catch((e) => setError(e instanceof Error ? e.message : "Unable to load Intake")).finally(() => setLoading(false)); }, [client, actor, query]);
  useEffect(load, [load, version]); const newSignals = signals.filter((s) => s.status === "RECEIVED");
  return <><PageTitle eyebrow="Intake" title="Intake" description="Understand what arrived and route it into the right operational context." actions={can(actor, "signals:write") ? <button className="primary" onClick={() => setReporting(!reporting)}>+ Report something</button> : undefined} /><ErrorText error={error} />{reporting ? <ReportForm client={client} rooms={rooms} onCancel={() => setReporting(false)} onSaved={() => { setReporting(false); load(); reload(); }} /> : null}{loading ? <Loading /> : <div className="oim-two-column wide-left"><section className="panel oim-section-panel"><div className="oim-section-heading"><div><p className="eyebrow">Triage queue</p><h2>{newSignals.length} new</h2></div></div>{signals.length ? <div className="intake-list">{signals.map((s) => <article className="intake-card" key={rowId(s)}><div className="intake-card-main"><div className="oim-card-kicker"><Status value={s.status} /><Severity value={s.severity} /><span>{text(s.source)}</span></div><h3>{text(s.title)}</h3><p>{text(s.description)}</p><small>{date(s.received_at)}</small></div><div className="intake-card-actions">{s.case_id ? <button className="primary" onClick={() => navigate(`workrooms/${text(s.case_id)}`)}>Open Workroom</button> : null}<button onClick={() => navigate(`signals/${rowId(s)}`)}>Open signal</button></div></article>)}</div> : <EmptyState title="No incoming signals">New reports and accepted inputs will appear here.</EmptyState>}</section><section className="panel oim-section-panel"><p className="eyebrow">Triage model</p><h2>Route to context</h2><div className="triage-guide"><div><strong>1</strong><span><b>Understand</b> what arrived and how urgent it is.</span></div><div><strong>2</strong><span><b>Connect</b> it to an existing Workroom when the situation already exists.</span></div><div><strong>3</strong><span><b>Act</b> through an Action or processing workflow.</span></div></div></section></div>}</>;
}
function ReportForm({ client, rooms, onCancel, onSaved }: { client: OrgoClient; rooms: Row[]; onCancel(): void; onSaved(): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(""); const raw = Object.fromEntries(new FormData(e.currentTarget)); try { await client.request("signals", "POST", { source: "manual", title: raw.title, description: raw.description, label: raw.label, severity: raw.severity, type: raw.type, category: raw.category, ...(raw.case_id ? { case_id: raw.case_id } : {}) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to submit report"); } finally { setBusy(false); } }
  return <section className="panel oim-form-panel report-panel"><div className="oim-section-heading"><div><p className="eyebrow">New input</p><h2>Report something</h2></div><button onClick={onCancel}>Cancel</button></div><form className="oim-form" onSubmit={submit}><label className="wide">What happened?<input name="title" required autoFocus maxLength={500} /></label><label className="wide">Context<textarea name="description" rows={4} maxLength={20000} /></label><label>Urgency<select name="severity" defaultValue="MODERATE"><option value="MINOR">Minor</option><option value="MODERATE">Moderate</option><option value="MAJOR">Major</option><option value="CRITICAL">Critical</option></select></label><label>Kind<select name="category" defaultValue="request"><option value="request">Request</option><option value="incident">Incident</option><option value="update">Update</option><option value="report">Report</option><option value="distribution">Distribution</option></select></label><label>Type<input name="type" defaultValue="general" /></label><label>Existing Workroom<select name="case_id"><option value="">No Workroom yet</option>{rooms.map((r) => <option key={rowId(r)} value={rowId(r)}>{text(r.title)}</option>)}</select></label><input type="hidden" name="label" value="1.11" /><div className="wide"><ErrorText error={error} /><button className="primary" disabled={busy}>{busy ? "Reporting…" : "Report"}</button></div></form></section>;
}

function TeamSurface({ client, actor, navigate, query, version }: Props) {
  const [tasks, setTasks] = useState<Row[]>([]), [users, setUsers] = useState<Row[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""); useEffect(() => { let cancelled = false; setLoading(true); void Promise.all([client.request<Row>(`tasks?limit=100&offset=0${query ? `&search=${encodeURIComponent(query)}` : ""}`), can(actor, "people:read") ? client.request<Row[]>("users").catch(() => []) : Promise.resolve([] as Row[])]).then(([t, u]) => { if (!cancelled) { setTasks(rows(t.items)); setUsers(u); } }).catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Unable to load Team")).finally(() => !cancelled && setLoading(false)); return () => { cancelled = true; }; }, [client, actor, query, version]);
  const map = new Map(users.map((u) => [rowId(u), text(u.display_name) || text(u.email)])), grouped = new Map<string, Row[]>(); tasks.filter((t) => !terminalTask.has(text(t.status))).forEach((t) => { const owner = text(t.owner_user_id) || "unassigned"; grouped.set(owner, [...(grouped.get(owner) ?? []), t]); });
  return <><PageTitle eyebrow="Supervisor" title="Team" description="Where work is assigned, blocked, or at risk across the team." /><ErrorText error={error} />{loading ? <Loading /> : <div className="team-grid">{[...grouped.entries()].sort((a, b) => b[1].length - a[1].length).map(([owner, owned]) => { const blocked = owned.filter((t) => ["ON_HOLD", "ESCALATED"].includes(text(t.status))); return <section className="panel team-column" key={owner}><div className="team-person"><div className="avatar">{owner === "unassigned" ? "?" : (map.get(owner) ?? owner).slice(0, 1).toUpperCase()}</div><div><h2>{owner === "unassigned" ? "Unassigned" : map.get(owner) ?? "Assigned user"}</h2><p>{owned.length} active · {blocked.length} blocked</p></div></div><div className="action-list">{owned.sort(compareTasks).slice(0, 12).map((t) => <ActionCard key={rowId(t)} task={t} navigate={navigate} compact />)}</div></section>; })}{!grouped.size ? <EmptyState title="No active team work" /> : null}</div>}</>;
}

function SituationSurface({ client, navigate, query, version }: Props) {
  const [rooms, setRooms] = useState<Row[]>([]), [tasks, setTasks] = useState<Row[]>([]), [insights, setInsights] = useState<Row>({}), [loading, setLoading] = useState(true), [error, setError] = useState(""); useEffect(() => { let cancelled = false; setLoading(true); const suffix = query ? `&search=${encodeURIComponent(query)}` : ""; void Promise.all([client.request<Row>(`cases?limit=100&offset=0${suffix}`), client.request<Row>(`tasks?limit=100&offset=0${suffix}`), client.request<Row>("insights/overview").catch(() => ({}))]).then(([c, t, i]) => { if (!cancelled) { setRooms(rows(c.items)); setTasks(rows(t.items)); setInsights(i); } }).catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Unable to load Situation")).finally(() => !cancelled && setLoading(false)); return () => { cancelled = true; }; }, [client, query, version]);
  const activeRooms = rooms.filter((r) => !["resolved", "archived"].includes(text(r.status))), critical = activeRooms.filter((r) => text(r.severity).toLowerCase() === "critical" || modeOf(r) === "incident"), activeTasks = tasks.filter((t) => !terminalTask.has(text(t.status))), blocked = activeTasks.filter((t) => ["ON_HOLD", "ESCALATED", "FAILED"].includes(text(t.status)));
  return <><PageTitle eyebrow="Situation" title="Situation" description="A shared operational picture of the work that most needs leadership attention." /><ErrorText error={error} />{loading ? <Loading /> : <><div className="oim-metrics"><Metric value={activeRooms.length} label="Active Workrooms" /><Metric value={critical.length} label="Critical / incident" emphasis={critical.length > 0} /><Metric value={activeTasks.length} label="Open Actions" /><Metric value={blocked.length} label="Blocked / escalated" emphasis={blocked.length > 0} /></div><div className="oim-two-column wide-left"><section className="panel oim-section-panel"><p className="eyebrow">Attention</p><h2>Critical Workrooms</h2>{critical.length ? <div className="situation-list">{critical.map((r) => <button key={rowId(r)} onClick={() => navigate(`workrooms/${rowId(r)}`)}><span><strong>{text(r.title)}</strong><small>{modeName(modeOf(r))} · updated {relative(r.updated_at ?? r.created_at)}</small></span><div><Severity value={r.severity} /><Status value={r.status} /></div></button>)}</div> : <EmptyState title="No critical Workrooms" />}</section><section className="panel oim-section-panel"><p className="eyebrow">Read model</p><h2>Operational indicators</h2>{Object.keys(insights).length ? <div className="insight-facts">{Object.entries(insights).slice(0, 12).map(([k, v]) => <div key={k}><span>{k.replaceAll("_", " ")}</span><strong>{typeof v === "object" ? JSON.stringify(v) : text(v)}</strong></div>)}</div> : <EmptyState title="No additional indicators available" />}</section></div></>}</>;
}
