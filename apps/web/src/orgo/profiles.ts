export type Section =
  | "today"
  | "workrooms"
  | "intake"
  | "team"
  | "situation"
  | "processes"
  | "identity"
  | "maintenance"
  | "hr"
  | "education"
  | "communications"
  | "system"
  | "offline"
  | "routing"
  | "reports"
  | "cases"
  | "tasks"
  | "my-work"
  | "signals"
  | "workflows"
  | "people"
  | "insights"
  | "audit"
  | "integrations"
  | "settings"
  | "notifications";
export const routes: Record<
  Section,
  { label: string; permission: string; description: string }
> = {
  today: {
    label: "Today",
    permission: "work:read",
    description: "The work that needs your attention now.",
  },
  workrooms: {
    label: "Workrooms",
    permission: "work:read",
    description: "Shared operational context for coordinated work.",
  },
  intake: {
    label: "Intake",
    permission: "signals:read",
    description: "Understand what arrived and route it into context.",
  },
  team: {
    label: "Team",
    permission: "work:read",
    description: "Assignments, load, blockers, and team attention.",
  },
  situation: {
    label: "Situation",
    permission: "work:read",
    description: "A shared operational picture across active work.",
  },
  processes: {
    label: "Processes",
    permission: "workflows:read",
    description: "External waits, decisions, and retries.",
  },
  identity: {
    label: "Access",
    permission: "identity:manage",
    description: "Accounts, roles, and tokens.",
  },
  maintenance: {
    label: "Maintenance",
    permission: "maintenance:read",
    description: "Assets and maintenance schedule.",
  },
  hr: {
    label: "Human Resources",
    permission: "hr:read",
    description: "Confidential cases and follow-up.",
  },
  education: {
    label: "Education",
    permission: "education:read",
    description: "Groups, members, and support.",
  },
  communications: {
    label: "Messages",
    permission: "notifications:write",
    description: "Templates and deliveries.",
  },
  system: {
    label: "System Operations",
    permission: "system:manage",
    description: "Workers, queues, and retries.",
  },
  offline: {
    label: "Offline",
    permission: "sync:write",
    description: "Local commands and synchronization.",
  },
  routing: {
    label: "Routing",
    permission: "routing:read",
    description: "Work distribution.",
  },
  reports: {
    label: "Reports",
    permission: "insights:read",
    description: "Exports of visible work.",
  },
  cases: {
    label: "Cases",
    permission: "work:read",
    description: "Technical Case collection. Use Workrooms for ordinary coordination.",
  },
  tasks: {
    label: "Tasks",
    permission: "work:read",
    description: "Technical Task collection. Actions are presented in Workrooms.",
  },
  "my-work": {
    label: "My Work",
    permission: "work:read",
    description: "Tasks assigned to you.",
  },
  signals: {
    label: "Signals",
    permission: "signals:read",
    description: "Technical accepted-input collection. Use Intake for ordinary triage.",
  },
  workflows: {
    label: "Workflows",
    permission: "workflows:read",
    description: "Published rules and immutable versions.",
  },
  people: {
    label: "People",
    permission: "people:read",
    description: "People in your organization.",
  },
  insights: {
    label: "Insights",
    permission: "insights:read",
    description: "A view of the operational situation.",
  },
  audit: {
    label: "Audit",
    permission: "audit:read",
    description: "Accepted operations and their actors.",
  },
  integrations: {
    label: "Integrations",
    permission: "integrations:read",
    description: "External requests and their receipts.",
  },
  settings: {
    label: "Settings",
    permission: "config:read",
    description: "Default values for your organization.",
  },
  notifications: {
    label: "Notifications",
    permission: "notifications:read",
    description: "Messages addressed to you.",
  },
};

/**
 * Presentation composition only. API authorization remains authoritative.
 * Technical collections are retained during the migration so existing deep
 * links and the browser acceptance suite remain compatible.
 */
export const profiles: Record<string, { home: Section; sections: Section[] }> = {
  Operations: {
    home: "today",
    sections: [
      "today",
      "my-work",
      "workrooms",
      "intake",
      "notifications",
      "offline",
      // Transitional technical routes. Keep until OIM acceptance replaces the
      // legacy browser journeys with equivalent human-surface coverage.
      "cases",
      "tasks",
      "signals",
      "processes",
    ],
  },
  "My Work": {
    home: "today",
    sections: ["today", "my-work", "workrooms", "notifications", "offline", "cases"],
  },
  Supervisor: {
    home: "team",
    sections: [
      "team",
      "situation",
      "today",
      "workrooms",
      "insights",
      "people",
      "processes",
      "reports",
      "cases",
      "tasks",
    ],
  },
  Intake: { home: "intake", sections: ["intake", "workrooms", "signals", "cases"] },
  "Workflow Admin": {
    home: "workflows",
    sections: [
      "workflows",
      "workrooms",
      "signals",
      "processes",
      "routing",
      "integrations",
      "settings",
    ],
  },
  Executive: {
    home: "situation",
    sections: ["situation", "workrooms", "insights", "reports", "cases"],
  },
  Embedded: { home: "workrooms", sections: ["workrooms", "my-work", "cases", "tasks"] },
  "Full Control Panel": {
    home: "situation",
    sections: Object.keys(routes) as Section[],
  },
};
