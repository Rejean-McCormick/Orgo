export type Section =
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
  processes: {
    label: "Processus",
    permission: "workflows:read",
    description: "Attentes externes, décisions et reprises.",
  },
  identity: {
    label: "Accès",
    permission: "identity:manage",
    description: "Comptes, rôles et jetons.",
  },
  maintenance: {
    label: "Maintenance",
    permission: "maintenance:read",
    description: "Équipements et calendrier des interventions.",
  },
  hr: {
    label: "Ressources humaines",
    permission: "hr:read",
    description: "Dossiers confidentiels et suivis.",
  },
  education: {
    label: "Éducation",
    permission: "education:read",
    description: "Groupes, membres et accompagnement.",
  },
  communications: {
    label: "Messages",
    permission: "notifications:write",
    description: "Modèles et envois.",
  },
  system: {
    label: "Exploitation",
    permission: "system:manage",
    description: "Workers, files et reprises.",
  },
  offline: {
    label: "Hors ligne",
    permission: "sync:write",
    description: "Commandes locales et synchronisation.",
  },
  routing: {
    label: "Routage",
    permission: "routing:read",
    description: "Distribution du travail.",
  },
  reports: {
    label: "Rapports",
    permission: "insights:read",
    description: "Exports des travaux visibles.",
  },
  cases: {
    label: "Dossiers",
    permission: "work:read",
    description: "Le contexte durable de votre travail.",
  },
  tasks: {
    label: "Tâches",
    permission: "work:read",
    description: "Les actions à mener, du début à la résolution.",
  },
  "my-work": {
    label: "Mon travail",
    permission: "work:read",
    description: "Les tâches qui vous sont attribuées.",
  },
  signals: {
    label: "Signaux",
    permission: "signals:read",
    description: "Les entrées reçues, leur traitement et leur contexte.",
  },
  workflows: {
    label: "Workflows",
    permission: "workflows:read",
    description: "Règles publiées et versions immuables.",
  },
  people: {
    label: "Personnes",
    permission: "people:read",
    description: "Les personnes de votre organisation.",
  },
  insights: {
    label: "Indicateurs",
    permission: "insights:read",
    description: "Une vue sur la situation opérationnelle.",
  },
  audit: {
    label: "Audit",
    permission: "audit:read",
    description: "Les opérations acceptées et leurs auteurs.",
  },
  integrations: {
    label: "Intégrations",
    permission: "integrations:read",
    description: "Les demandes externes et leurs reçus.",
  },
  settings: {
    label: "Configuration",
    permission: "config:read",
    description: "Les valeurs par défaut de votre organisation.",
  },
  notifications: {
    label: "Notifications",
    permission: "notifications:read",
    description: "Les messages qui vous sont destinés.",
  },
};
export const profiles: Record<string, { home: Section; sections: Section[] }> =
  {
    Operations: {
      home: "cases",
      sections: [
        "cases",
        "tasks",
        "signals",
        "processes",
        "notifications",
        "offline",
      ],
    },
    "My Work": {
      home: "my-work",
      sections: ["my-work", "cases", "notifications", "offline"],
    },
    Supervisor: {
      home: "insights",
      sections: [
        "insights",
        "cases",
        "tasks",
        "people",
        "processes",
        "reports",
      ],
    },
    Intake: { home: "signals", sections: ["signals", "cases"] },
    "Workflow Admin": {
      home: "workflows",
      sections: [
        "workflows",
        "signals",
        "processes",
        "routing",
        "integrations",
        "settings",
      ],
    },
    Executive: { home: "insights", sections: ["insights", "cases"] },
    Embedded: { home: "cases", sections: ["cases", "tasks"] },
    "Full Control Panel": {
      home: "cases",
      sections: Object.keys(routes) as Section[],
    },
  };
