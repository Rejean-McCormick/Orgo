<!-- INDEX: Doc 7 – Organization Profiles & Behavioural Archetypes (profiles YAML) (Use YAML comments only so the file stays valid.) -->
INDEX
1. _template – Schema template (reference only)
2. default – Balanced default organizational profile
3. friend_group – Low‑stakes social group
4. hospital – Clinical / hospital environment (safety‑critical)
5. advocacy_group – Advocacy / human‑rights NGO
6. retail_chain – Distributed retail / franchise operations
7. military_organization – Highly sensitive, fully audited environment
8. environmental_group – Environmental / climate organization
9. artist_collective – Creative collective, relaxed timing



profiles:
  # ---------------------------------------------------------------------------
  # SCHEMA TEMPLATE (REFERENCE ONLY)
  # ---------------------------------------------------------------------------
  _template:
    description: "Template profile – do not use directly, copy and override."

    # --- File-level metadata for this profile (per your config checklist) ---
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"               # dev | staging | prod | offline

    # 1. Reactivity / Escalation timing
    reactivity_seconds: 0               # base time before first escalation (in seconds)
    max_escalation_seconds: 0           # hard cap until issue must reach top (in seconds)

    # 2. Information visibility
    # JSON values map to canonical VISIBILITY enum:
    #   public      -> PUBLIC
    #   internal    -> INTERNAL
    #   restricted  -> RESTRICTED
    #   anonymised  -> ANONYMISED
    transparency_level: balanced        # full | balanced | restricted | private

    # 3. Escalation structure
    escalation_granularity: moderate    # relaxed | moderate | detailed | aggressive

    # 4. Review cadence
    review_frequency: monthly           # real_time | daily | weekly | monthly | quarterly | yearly | ad_hoc

    # 5. Who gets notified
    notification_scope: department      # user | team | department | org_wide

    # 6. Pattern detection
    pattern_sensitivity: medium         # low | medium | high | critical
    pattern_window_days: 30             # time window for pattern counting
    pattern_min_events: 3               # min similar events to trigger pattern

    # 7. Severity / auto‑escalation
    # severity_threshold is a coarse “how sensitive” knob:
    #   very_high = only the worst issues escalate fast
    #   high      = major+ escalate fast
    #   medium    = major+ and some moderate escalate fast
    #   low       = even minor issues escalate fast
    severity_threshold: medium          # very_high | high | medium | low

    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: true
      minor:
        immediate_escalation: false

    # 8. Logging & traceability
    logging_level: standard             # minimal | standard | detailed | audit
    log_retention_days: 365             # days logs (and operational records) are kept

    # 9. Automation level
    automation_level: medium            # manual | low | medium | high | full

    # 10. Defaults for task metadata
    # JSON values map to canonical enums:
    #   default_priority: low|medium|high|critical -> TASK_PRIORITY
    #   visibility: public|internal|restricted|anonymised -> VISIBILITY
    default_task_metadata:
      visibility: internal              # public | internal | restricted | anonymised
      default_priority: medium          # low | medium | high | critical
      default_reactivity_seconds: 86400 # default SLA for tasks created under this profile

    # 11. Cyclic Overview (periodic pattern reviews & triggers)
    cyclic_overview:
      enabled: true
      schedule:
        weekly: false
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 3
          window_days: 30
        cross_departmental_trends: false
        high_risk_indicators: false

  # ---------------------------------------------------------------------------
  # DEFAULT PROFILE
  # Balanced org-wide defaults when nothing more specific is selected
  # ---------------------------------------------------------------------------
  default:
    description: "Default balanced organizational profile used when no more specific archetype is selected."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: moderate (12–24h)
    reactivity_seconds: 43200           # 12 hours
    max_escalation_seconds: 172800      # 48 hours

    transparency_level: balanced
    escalation_granularity: moderate
    review_frequency: monthly
    notification_scope: department      # canonical enum value

    pattern_sensitivity: medium
    pattern_window_days: 30
    pattern_min_events: 3

    severity_threshold: medium
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: true
      minor:
        immediate_escalation: false

    logging_level: standard
    log_retention_days: 1095            # ~3 years

    automation_level: medium

    default_task_metadata:
      visibility: internal
      default_priority: medium
      default_reactivity_seconds: 43200

    cyclic_overview:
      enabled: true
      schedule:
        weekly: true
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 3
          window_days: 30
        cross_departmental_trends: true
        high_risk_indicators: true

  # ---------------------------------------------------------------------------
  # 1. FRIEND GROUP
  # Low‑stakes social group, almost everything transparent, low urgency
  # ---------------------------------------------------------------------------
  friend_group:
    description: "Small, low‑stakes social group; almost everything is transparent; escalation over days or weeks."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: relaxed (days)
    reactivity_seconds: 259200          # 3 days before first escalation
    max_escalation_seconds: 1814400     # 21 days to reach top level

    # Transparency: fully transparent to members
    transparency_level: full            # everyone in the group can see updates

    # Escalation structure: detailed (but slow)
    escalation_granularity: detailed    # all intermediate levels exist but move slowly

    # Reviews: rare / ad‑hoc
    review_frequency: ad_hoc            # explicit annual or ad‑hoc reviews only

    # Notification scope: small team
    notification_scope: team            # only people directly involved / mentioned

    # Patterns: only very persistent patterns matter
    pattern_sensitivity: low
    pattern_window_days: 90             # look over 3 months
    pattern_min_events: 5               # need at least 5 similar events

    # Severity: only very serious issues escalate fast
    severity_threshold: very_high
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: false
      minor:
        immediate_escalation: false

    # Logging: very lightweight; short retention
    logging_level: minimal
    log_retention_days: 180             # ~6 months, matches “3–6 months” retention

    # Automation: mostly manual
    automation_level: manual

    # Default metadata for tasks created under this profile
    default_task_metadata:
      visibility: public                # visible to the whole group
      default_priority: low
      default_reactivity_seconds: 259200

    # Cyclic Overview
    cyclic_overview:
      enabled: true
      schedule:
        weekly: false
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 5
          window_days: 90
        cross_departmental_trends: false
        high_risk_indicators: false

  # ---------------------------------------------------------------------------
  # 2. HOSPITAL
  # High‑stakes, safety‑critical environment, strong audit and long retention
  # ---------------------------------------------------------------------------
  hospital:
    description: "Clinical / hospital environment: life‑critical, rapid escalation, strong privacy, full audit trail."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: immediate (minutes)
    reactivity_seconds: 300             # 5 minutes to first escalation
    max_escalation_seconds: 3600        # 1 hour to reach top escalation

    # Transparency: moderately private (only key teams)
    transparency_level: restricted      # visible to designated clinical / ops roles

    # Escalation structure: accelerated / aggressive
    escalation_granularity: aggressive  # skips intermediate levels when needed

    # Reviews: continuous / real‑time
    review_frequency: real_time         # operational reviews happen continuously

    # Notification scope: focused small team
    notification_scope: team            # on‑call clinical / safety team

    # Patterns: highly sensitive
    pattern_sensitivity: high
    pattern_window_days: 7              # last week of events
    pattern_min_events: 2               # 2 similar incidents trigger pattern alert

    # Severity: low threshold – even minor issues escalate quickly
    severity_threshold: low
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: true
      minor:
        immediate_escalation: false     # escalated fast, but not “immediate”

    # Logging: full audit trail and long retention
    logging_level: audit
    log_retention_days: 3650            # ~10 years, regulatory/audit needs

    # Automation: high (but still supervised)
    automation_level: high

    # Default metadata
    default_task_metadata:
      visibility: restricted            # minimal set of roles
      default_priority: high
      default_reactivity_seconds: 300

    # Cyclic Overview
    cyclic_overview:
      enabled: true
      schedule:
        weekly: true
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 2
          window_days: 7
        cross_departmental_trends: true
        high_risk_indicators: true

  # ---------------------------------------------------------------------------
  # 3. ADVOCACY GROUP
  # Mission‑driven NGO; responsive but not as extreme as hospitals
  # ---------------------------------------------------------------------------
  advocacy_group:
    description: "Advocacy / human‑rights NGO: responsive within 12–24h, balanced transparency, strong but not extreme traceability."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: responsive (12–24h)
    reactivity_seconds: 43200           # 12 hours to first escalation
    max_escalation_seconds: 172800      # 48 hours to reach top

    # Transparency: moderately transparent
    transparency_level: balanced        # visible to relevant teams + leadership

    # Escalation structure: moderate
    escalation_granularity: moderate

    # Reviews: frequent (weekly)
    review_frequency: weekly

    # Notification scope: departmental
    notification_scope: department      # campaign / program team + leadership

    # Patterns: balanced sensitivity
    pattern_sensitivity: medium
    pattern_window_days: 30             # last month
    pattern_min_events: 3               # 3 similar events trigger pattern

    # Severity: balanced threshold
    severity_threshold: medium
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: true
      minor:
        immediate_escalation: false

    # Logging: standard, moderate retention
    logging_level: standard
    log_retention_days: 1095            # ~3 years (within 1–5 year band)

    # Automation: moderate, human oversight
    automation_level: medium

    # Defaults
    default_task_metadata:
      visibility: internal
      default_priority: medium
      default_reactivity_seconds: 43200

    # Cyclic Overview
    cyclic_overview:
      enabled: true
      schedule:
        weekly: true
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 3
          window_days: 30
        cross_departmental_trends: true
        high_risk_indicators: true

  # ---------------------------------------------------------------------------
  # 4. RETAIL CHAIN
  # Distributed stores, operational focus, balanced cost vs. oversight
  # ---------------------------------------------------------------------------
  retail_chain:
    description: "Multi‑store retail / franchise: 24–72h SLA, focus on incidents and operations, moderate automation and logging."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: 24–72h
    reactivity_seconds: 86400           # 24 hours to first escalation
    max_escalation_seconds: 259200      # 72 hours to reach top

    # Transparency: balanced
    transparency_level: balanced        # store + area manager + HQ ops

    # Escalation structure: moderate
    escalation_granularity: moderate

    # Reviews: monthly
    review_frequency: monthly

    # Notification scope: departmental (store + ops)
    notification_scope: department

    # Patterns: moderate sensitivity
    pattern_sensitivity: medium
    pattern_window_days: 60             # last 2 months
    pattern_min_events: 4               # 4 similar cases needed for pattern

    # Severity: high threshold (only severe issues immediate)
    severity_threshold: high
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: true
      minor:
        immediate_escalation: false

    # Logging: standard, medium‑term retention
    logging_level: standard
    log_retention_days: 1825            # ~5 years

    # Automation: moderate
    automation_level: medium

    # Defaults
    default_task_metadata:
      visibility: internal
      default_priority: medium
      default_reactivity_seconds: 86400

    # Cyclic Overview
    cyclic_overview:
      enabled: true
      schedule:
        weekly: false
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 4
          window_days: 60
        cross_departmental_trends: true
        high_risk_indicators: false

  # ---------------------------------------------------------------------------
  # 5. MILITARY ORGANIZATION
  # Extremely sensitive, private, fully automated, long/indefinite retention
  # ---------------------------------------------------------------------------
  military_organization:
    description: "Military / defense environment: immediate escalation, highly private, full automation and long‑term retention."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: immediate (minutes)
    reactivity_seconds: 120             # 2 minutes to first escalation
    max_escalation_seconds: 900         # 15 minutes to reach top

    # Transparency: highly private
    transparency_level: private         # only explicitly authorized roles

    # Escalation structure: broad/aggressive
    escalation_granularity: aggressive  # jumps quickly to higher levels

    # Reviews: continuous / real time
    review_frequency: real_time

    # Notification scope: very small team (ops / command)
    notification_scope: team

    # Patterns: immediate, very high sensitivity
    pattern_sensitivity: critical
    pattern_window_days: 7              # any 7‑day window
    pattern_min_events: 2               # 1–2 incidents acceptable; we use 2

    # Severity: effectively no threshold – everything escalates quickly
    severity_threshold: low
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: true
      minor:
        immediate_escalation: true

    # Logging: full audit, effectively indefinite retention
    logging_level: audit
    log_retention_days: 36500           # ~100 years (effectively “indefinite”)

    # Automation: fully automated, with human override
    automation_level: full

    # Defaults
    default_task_metadata:
      visibility: restricted            # tightly scoped, non‑public
      default_priority: high
      default_reactivity_seconds: 120

    # Cyclic Overview
    cyclic_overview:
      enabled: true
      schedule:
        weekly: true
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 2
          window_days: 7
        cross_departmental_trends: true
        high_risk_indicators: true

  # ---------------------------------------------------------------------------
  # 6. ENVIRONMENTAL GROUP
  # Campaign‑driven organization, high pattern sensitivity, org‑wide signalling
  # ---------------------------------------------------------------------------
  environmental_group:
    description: "Environmental / climate organization: high pattern sensitivity, org‑wide signalling, balanced oversight."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: responsive (12–24h)
    reactivity_seconds: 43200           # 12 hours
    max_escalation_seconds: 172800      # 48 hours

    # Transparency: moderately transparent
    transparency_level: balanced        # visible to relevant teams across org

    # Escalation: moderate
    escalation_granularity: moderate

    # Reviews: frequent (weekly / bi‑weekly)
    review_frequency: weekly

    # Notification scope: org‑wide for key events
    notification_scope: org_wide

    # Patterns: high sensitivity (campaigns, repeated abuses)
    pattern_sensitivity: high
    pattern_window_days: 30             # last month
    pattern_min_events: 3

    # Severity: balanced threshold
    severity_threshold: medium
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: true
      minor:
        immediate_escalation: false

    # Logging: standard, moderate‑term retention
    logging_level: standard
    log_retention_days: 1825            # ~5 years

    # Automation: moderate, to assist volunteers/staff
    automation_level: medium

    # Defaults
    default_task_metadata:
      visibility: internal
      default_priority: medium
      default_reactivity_seconds: 43200

    # Cyclic Overview
    cyclic_overview:
      enabled: true
      schedule:
        weekly: true
        monthly: true
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 3
          window_days: 30
        cross_departmental_trends: true
        high_risk_indicators: true

  # ---------------------------------------------------------------------------
  # 7. ARTIST COLLECTIVE
  # Creative group; low stakes, relaxed timing, minimal logging
  # ---------------------------------------------------------------------------
  artist_collective:
    description: "Artist / creative collective: relaxed deadlines, balanced transparency within the group, minimal logging."
    metadata:
      version: "3.0"
      last_updated: "2025-11-19"
      environment: "prod"

    # Reactivity: relaxed (days/weeks)
    reactivity_seconds: 259200          # 3 days
    max_escalation_seconds: 1814400     # 21 days

    # Transparency: balanced within the collective
    transparency_level: balanced

    # Escalation: detailed but lenient
    escalation_granularity: detailed

    # Reviews: occasional (quarterly)
    review_frequency: quarterly

    # Notification scope: relevant project teams
    notification_scope: department

    # Patterns: low sensitivity
    pattern_sensitivity: low
    pattern_window_days: 90             # 3 months
    pattern_min_events: 5

    # Severity: high threshold (only severe issues escalate quickly)
    severity_threshold: high
    severity_policy:
      critical:
        immediate_escalation: true
      major:
        immediate_escalation: false
      minor:
        immediate_escalation: false

    # Logging: minimal, short retention
    logging_level: minimal
    log_retention_days: 180             # ~6 months

    # Automation: low (mostly human‑driven)
    automation_level: low

    # Defaults
    default_task_metadata:
      visibility: internal
      default_priority: low
      default_reactivity_seconds: 259200

    # Cyclic Overview
    cyclic_overview:
      enabled: true
      schedule:
        weekly: false
        monthly: false
        yearly: true
      threshold_triggers:
        incident_frequency:
          min_events: 5
          window_days: 90
        cross_departmental_trends: false
        high_risk_indicators: false
