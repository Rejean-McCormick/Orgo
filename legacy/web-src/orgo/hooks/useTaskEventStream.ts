// apps/web/src/orgo/hooks/useTaskEventStream.ts
import { useCallback, useEffect, useRef, useState } from "react";

export type TaskEventType =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "ownership_changed"
  | "comment_added"
  | "email_linked"
  | "escalated"
  | "deadline_updated"
  | "metadata_updated"
  | string;

export interface TaskEvent {
  id?: string;
  taskId: string;
  organizationId?: string;
  eventType: TaskEventType;
  oldValue?: unknown;
  newValue?: unknown;
  actorUserId?: string | null;
  actorRoleId?: string | null;
  origin?: string;
  createdAt: string;
  // Allow extra fields from backend without losing them
  [key: string]: unknown;
}

export interface UseTaskEventStreamOptions {
  /**
   * Optional task filter. If provided, the client will request
   * events only for this task (server must support this convention).
   */
  taskId?: string;

  /**
   * Optional organization filter. Can be used by the server to scope events.
   */
  organizationId?: string;

  /**
   * Whether the WebSocket connection should be active.
   * Defaults to true.
   */
  enabled?: boolean;

  /**
   * Whether the hook should try to automatically reconnect on unexpected close.
   * Defaults to true.
   */
  autoReconnect?: boolean;

  /**
   * Optional callback invoked for every normalized TaskEvent.
   */
  onEvent?: (event: TaskEvent) => void;

  /**
   * Optional callback invoked when the WebSocket errors.
   */
  onError?: (error: Error) => void;
}

export interface UseTaskEventStreamResult {
  /**
   * All TaskEvents received during the lifetime of this hook instance.
   */
  events: TaskEvent[];

  /**
   * The most recently received TaskEvent, or null if none.
   */
  lastEvent: TaskEvent | null;

  /**
   * True while the WebSocket connection is open.
   */
  isConnected: boolean;

  /**
   * True while we are in the process of establishing a connection.
   */
  isConnecting: boolean;

  /**
   * Last error encountered by the WebSocket, if any.
   */
  error: Error | null;

  /**
   * Manually close the WebSocket and stop auto‑reconnect.
   */
  disconnect: () => void;

  /**
   * Force a reconnect (will reopen the WebSocket with current options).
   */
  reconnect: () => void;

  /**
   * Clear the in‑memory list of events and lastEvent.
   */
  clearEvents: () => void;
}

/**
 * Derive the WebSocket URL used for TaskEventsGateway.
 *
 * Priority:
 * 1. NEXT_PUBLIC_ORGO_TASK_EVENTS_WS_URL (full ws:// or wss:// URL)
 * 2. window.location.origin + /api/v3/task-events/stream (converted to ws:// or wss://)
 *
 * Optional filters (task_id, organization_id) are appended as query parameters.
 */
function resolveTaskEventsWsUrl(params: {
  taskId?: string;
  organizationId?: string;
}): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const explicit = process.env.NEXT_PUBLIC_ORGO_TASK_EVENTS_WS_URL;
  const httpUrl =
    explicit && explicit.length > 0
      ? explicit
      : `${window.location.origin}/api/v3/task-events/stream`;

  let url: URL;
  try {
    url = new URL(httpUrl, window.location.origin);
  } catch {
    return null;
  }

  // Ensure WebSocket protocol
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  if (params.taskId) {
    url.searchParams.set("task_id", params.taskId);
  }

  if (params.organizationId) {
    url.searchParams.set("organization_id", params.organizationId);
  }

  return url.toString();
}

function extractTaskEventPayload(raw: unknown): any {
  if (!raw || typeof raw !== "object") {
    return raw;
  }

  const obj = raw as any;

  // Common wrapping patterns: { event: {...} }, { data: {...} }, { payload: {...} }
  if (obj.event) return obj.event;
  if (obj.payload) return obj.payload;
  if (obj.data) return obj.data;

  return obj;
}

function normalizeTaskEvent(raw: unknown): TaskEvent | null {
  if (!raw) return null;

  const envelope = extractTaskEventPayload(raw);
  if (!envelope || typeof envelope !== "object") {
    return null;
  }

  const obj = envelope as any;

  const taskId = obj.task_id ?? obj.taskId;
  if (!taskId || typeof taskId !== "string") {
    // Not a task‑scoped event we understand
    return null;
  }

  const organizationId =
    obj.organization_id ??
    obj.organizationId ??
    (raw as any)?.organization_id ??
    (raw as any)?.organizationId;

  const eventType: TaskEventType =
    obj.event_type ??
    obj.eventType ??
    (raw as any)?.event_type ??
    (raw as any)?.eventType ??
    (raw as any)?.type ??
    "unknown";

  const createdAt: string =
    obj.created_at ??
    obj.createdAt ??
    (raw as any)?.created_at ??
    (raw as any)?.createdAt ??
    new Date().toISOString();

  const oldValue = obj.old_value ?? obj.oldValue;
  const newValue = obj.new_value ?? obj.newValue;

  const actorUserId =
    obj.actor_user_id ?? obj.actorUserId ?? (raw as any)?.actor_user_id;
  const actorRoleId =
    obj.actor_role_id ?? obj.actorRoleId ?? (raw as any)?.actor_role_id;

  const origin = obj.origin ?? (raw as any)?.origin;

  const id = obj.id ?? (raw as any)?.id;

  const event: TaskEvent = {
    id: typeof id === "string" ? id : undefined,
    taskId,
    organizationId:
      typeof organizationId === "string" ? organizationId : undefined,
    eventType,
    oldValue,
    newValue,
    actorUserId:
      typeof actorUserId === "string" || actorUserId === null
        ? actorUserId
        : undefined,
    actorRoleId:
      typeof actorRoleId === "string" || actorRoleId === null
        ? actorRoleId
        : undefined,
    origin: typeof origin === "string" ? origin : undefined,
    createdAt,
    // keep full raw payload attached for inspection if needed
    raw,
  };

  return event;
}

export function useTaskEventStream(
  options: UseTaskEventStreamOptions = {}
): UseTaskEventStreamResult {
  const {
    taskId,
    organizationId,
    enabled = true,
    autoReconnect = true,
    onEvent,
    onError,
  } = options;

  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<TaskEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const manuallyDisconnectedRef = useRef(false);
  const isMountedRef = useRef(false);
  const [reconnectCounter, setReconnectCounter] = useState(0);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  const disconnect = useCallback(() => {
    manuallyDisconnectedRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (isMountedRef.current) {
      setIsConnected(false);
      setIsConnecting(false);
    }
  }, []);

  const reconnect = useCallback(() => {
    manuallyDisconnectedRef.current = false;
    // Trigger effect to re-establish connection
    setReconnectCounter((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return;
    }

    const url = resolveTaskEventsWsUrl({ taskId, organizationId });

    if (!url) {
      const err = new Error("Unable to resolve TaskEvents WebSocket URL");
      setError(err);
      if (onError) {
        onError(err);
      }
      return;
    }

    isMountedRef.current = true;
    manuallyDisconnectedRef.current = false;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    setIsConnecting(true);
    setError(null);

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      setIsConnecting(false);
      setIsConnected(true);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!isMountedRef.current) return;

      let payload: unknown = event.data;
      if (typeof event.data === "string") {
        try {
          payload = JSON.parse(event.data);
        } catch {
          // keep as raw string if it is not valid JSON
          payload = event.data;
        }
      }

      const normalized = normalizeTaskEvent(payload);
      if (!normalized) {
        return;
      }

      setLastEvent(normalized);
      setEvents((prev) => [...prev, normalized]);

      if (onEvent) {
        onEvent(normalized);
      }
    };

    ws.onerror = () => {
      if (!isMountedRef.current) return;

      const err = new Error("TaskEvents WebSocket error");
      setError(err);
      if (onError) {
        onError(err);
      }
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;

      setIsConnected(false);
      setIsConnecting(false);
      wsRef.current = null;

      if (autoReconnect && !manuallyDisconnectedRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (
            !isMountedRef.current ||
            manuallyDisconnectedRef.current ||
            !autoReconnect
          ) {
            return;
          }
          setReconnectCounter((prev) => prev + 1);
        }, 3000);
      }
    };

    return () => {
      isMountedRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    autoReconnect,
    taskId,
    organizationId,
    onEvent,
    onError,
    reconnectCounter,
  ]);

  return {
    events,
    lastEvent,
    isConnected,
    isConnecting,
    error,
    disconnect,
    reconnect,
    clearEvents,
  };
}
