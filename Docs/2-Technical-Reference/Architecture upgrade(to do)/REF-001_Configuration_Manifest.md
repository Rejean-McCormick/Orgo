REF-001: Nervous System Configuration ManifestMeta FieldValueStatusDRAFTDate2025-12-17AuthorSenior ArchitectPurposeCentral source of truth for all Env Vars, Constants, and Flags required to run the Nervous System.1. Environment Variables (.env)These variables must be injected into the apps/api and apps/worker containers at runtime. Do not commit values to Git.1.1 AI Service ProvidersCredentials for the external "Brain" components.VariableDescriptionRequired?Example ValueSENTIENT_API_URLEndpoint for the Perception (Input) API.YEShttps://api.sentient.ai/v1/parseSENTIENT_API_KEYSecret key for SenTient.YESsk_live_...ARCHITECT_LLM_PROVIDERThe backend provider for Architect (Output).YESopenaiARCHITECT_API_KEYSecret key for the LLM provider.YESsk_proj_...ARCHITECT_MODEL_IDThe specific model version to use.No (Default: gpt-4-turbo)gpt-4-1106-preview1.2 Infrastructure & QueuesRedis connections for the Bulkhead pattern.VariableDescriptionDefaultREDIS_QUEUE_URLConnection string for BullMQ.redis://localhost:6379QUEUE_CONCURRENCY_INGESTIONMax concurrent email parsers (I/O Bound).50QUEUE_CONCURRENCY_EXPRESSIONMax concurrent LLM generators (Rate-Limit Bound).51.3 Resilience TunablesCircuit Breaker thresholds.VariableDescriptionDefaultCB_AI_TIMEOUT_MSMax time to wait for AI response before failing.8000CB_AI_FAILURE_THRESHOLD% of failures before opening the circuit.50CB_AI_RESET_MSTime to wait before attempting to close circuit.300002. Shared System Constants (Code Alignment)These constants must be defined in a shared library (e.g., packages/config/src/constants.ts) to ensure apps/api (Producer) and apps/worker (Consumer) speak the exact same language.2.1 Queue Names (The "Lanes")Used by @nestjs/bullmq.TypeScriptexport const QUEUES = {
  // High Priority: Transactional Emails, Password Resets
  SYSTEM: 'queue:system',
  
  // Medium Priority: SenTient Email Ingestion
  INGESTION: 'queue:ingestion',
  
  // Low Priority: Architect LLM Generation
  EXPRESSION: 'queue:expression',
} as const;
2.2 Event Topics (The "Vocabulary")Used in the Outbox.eventType column and Pub/Sub routing.TypeScriptexport const EVENTS = {
  // Domain Events
  TASK_CREATED: 'domain.task.created',
  CASE_ESCALATED: 'domain.case.escalated',
  SAFETY_INCIDENT: 'domain.safety.incident',
  
  // System Events
  DLQ_POISON_PILL: 'system.dlq.poison_pill',
  AI_CIRCUIT_OPEN: 'system.ai.circuit_open'
} as const;
2.3 DLQ Status EnumsUsed in the ParsingDLQ table state machine.TypeScriptexport enum DLQStatus {
  NEW = 'NEW',             // Fresh failure, needs admin review
  REDRIVE_PENDING = 'PENDING', // Admin fixed it, waiting for ingestion
  REDRIVEN = 'REDRIVEN',   // Successfully re-processed
  IGNORED = 'IGNORED'      // Admin marked as spam/irrelevant
}
3. Feature Flags (LaunchDarkly / DB Flags)These flags allow us to kill specific parts of the Nervous System without redeploying code. Essential for "Incident Playbooks".Flag KeyTypeDescriptionDefaultenable_nervous_systemBooleanMaster switch. If false, system acts as legacy CRUD app.falseuse_sentient_parserBooleanIf true, route emails to AI. If false, use legacy Regex.falseuse_architect_generationBooleanIf true, generate custom text. If false, use static templates.falselog_ai_promptsBooleanLog full LLM prompts/responses (Caution: PII Risk).false4. Database Alignment (Prisma Schema)This configuration requires specific additions to schema.prisma to work.Extrait de code// 1. For Output Reliability
model Outbox {
  id            String   @id @default(uuid())
  // ... fields as defined in SPEC-002
  @@map("outbox") // Table name alignment
}

// 2. For Input Reliability
model ParsingDLQ {
  id            String   @id @default(uuid())
  // ... fields as defined in SPEC-001
  @@map("parsing_dlq")
}

// 3. For Audit/Observability
model SystemLog {
  id            String   @id @default(uuid())
  level         String   // INFO, WARN, ERROR
  component     String   // "SenTient", "Architect"
  message       String
  metadata      Json?    // Stores token usage, cost, latency
  createdAt     DateTime @default(now())
}
5. Security Redaction Rules (Regex Config)The PII Redaction logic requires these patterns to be consistent across Ingestion and Expression.TypeScript// packages/utils/src/pii-redaction.ts
export const REDACTION_PATTERNS = {
  // Matches: 123-456-7890, (123) 456-7890, 123.456.7890
  PHONE: /(\+\d{1,2}\s?)?1?\-?\.?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
  
  // Matches: standard email format
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // Matches: 3 digits, 2 digits, 4 digits (US SSN)
  SSN: /\d{3}-\d{2}-\d{4}/g
};