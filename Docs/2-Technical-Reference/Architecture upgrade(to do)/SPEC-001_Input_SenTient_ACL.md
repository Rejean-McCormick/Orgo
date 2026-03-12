SPEC-001: SenTient Integration (Input & Perception)Meta FieldValueStatusDRAFTDate2025-12-17AuthorSenior ArchitectComponentapps/api/src/modules/perceptionPatternsAnti-Corruption Layer (ACL), Dead Letter Queue (DLQ), Circuit Breaker1. Overview & ObjectivesThe SenTient module acts as the "Sensory Cortex" for Orgo. Its primary responsibility is Perception: ingesting unstructured, noisy human signals (emails, voice transcripts, Slack messages) and normalizing them into structured, deterministic system commands.1.1 The ChallengeOrgo's core TaskService expects strict, validated inputs (e.g., CreateTaskDTO). Human communication is messy, ambiguous, and lacks structure. Additionally, SenTient (the AI provider) speaks in Wikidata Ontologies (Universal concepts), while Orgo speaks in Prisma Relational Schema (Local concepts).1.2 The SolutionWe will implement a Hexagonal Adapter containing a strict Anti-Corruption Layer (ACL). This layer creates a firewall between the external AI ontology and our internal domain model, ensuring that changes in the AI model never break the business logic.2. Architecture & Data Flow2.1 The PipelineIngestion: EmailIngestService receives a raw email (Subject + Body).Perception (External): The SenTientAdapter sends the raw text to the SenTient API.Normalization (ACL): SenTient returns a WikidataGraph. The SenTientACLService translates this graph into an internal SignalDTO.Execution (Core): The TaskService receives the SignalDTO and creates the Task.3. Data Contracts (The Boundary)We strictly define the inputs and outputs to enforce the ACL pattern.3.1 External Contract: SenTient Output (Wikidata)The AI returns a graph of entities based on the Wikidata Data Model.TypeScript// The "Dirty" External Model
interface WikidataEntity {
  id: string; // e.g., "Q12345" (The abstract concept)
  labels: Record<string, string>; // { en: "Broken Pipe" }
  claims: Record<string, WikidataClaim[]>;
}

interface WikidataClaim {
  property: string; // e.g., "P921" (Main Subject)
  value: {
    type: "string" | "time" | "wikibase-entityid";
    content: any; // e.g., "2025-12-17" or "Q999"
  };
  confidence: number; // 0.0 to 1.0
}
3.2 Internal Contract: Orgo Input (Prisma DTO)The Core accepts only clean, validated data.TypeScript// The "Clean" Internal Model
interface CreateTaskFromSignalDTO {
  title: string;          // Sanitized title
  description: string;    // Summarized description
  categoryId: string;     // Internal UUID from "Category" table
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  detectedUserEmail?: string; 
  metadata: {
    source: 'SENTIENT_EMAIL';
    originalMessageId: string;
    confidenceScore: number;
  };
}
4. The Anti-Corruption Layer (ACL) ImplementationPattern Reference:The SenTientACLService is the only place in the codebase allowed to import WikidataEntity. It performs three distinct translation steps.4.1 Step 1: Property Mapping (The Dictionary)We map Wikidata Properties (P-Codes) to Orgo Fields.Wikidata PropertyDescriptionOrgo FieldLogicP921Main SubjectTask.categoryIdSee Section 4.2P580Start TimeTask.startAtISO-8601 parsing.P582End TimeTask.dueAtISO-8601 parsing.P488ChairpersonTask.assigneeIdFuzzy Match on User Name.P571Inception DateTask.createdAtIf missing, use now().4.2 Step 2: Value Translation (The Thesaurus)We must map the values (Q-Codes) to our internal Database IDs.Scenario: SenTient returns P921: Q102 (Plumbing System).ACL Logic:Query Category table: SELECT * FROM categories WHERE wikidata_mapping = 'Q102'.Hit: Return category.id.Miss: Query Category table for wikidata_mapping = 'Q_GENERAL_MAINTENANCE' (Fallback).Critical Miss: If no fallback exists, flag as UNCATEGORIZED task.4.3 Step 3: Sentiment-to-Priority MappingWe derive Priority from the sentiment analysis provided by SenTient's metadata layer.TypeScriptfunction mapPriority(sentimentScore: number, urgencyKeywords: string[]): Priority {
  if (urgencyKeywords.includes('FIRE') || urgencyKeywords.includes('BLOOD')) {
    return 'CRITICAL';
  }
  if (sentimentScore < 0.2) return 'HIGH'; // Panic/Anger
  if (sentimentScore < 0.5) return 'MEDIUM';
  return 'LOW';
}
5. Operational Resilience & Error HandlingPattern Reference:5.1 The "Poison Pill" Strategy (DLQ)Parsing is the most fragile part of the system. We must assume some inputs will crash the parser.Schema:Extrait de codemodel ParsingDLQ {
  id          String   @id @default(uuid())
  rawPayload  Json     // The original email body
  errorReason String   // Stack trace or "JSON Parse Error"
  retryCount  Int      @default(0)
  status      String   // NEW, REDRIVEN, IGNORED
  createdAt   DateTime @default(now())
}
Workflow:Ingestion Worker picks up job.Try: Call SenTientAdapter.process().Catch (Transient): If HTTP 503 or Timeout -> Throw Error (triggers BullMQ exponential backoff).Catch (Permanent): If JsonParseError or ACLValidationError -> Move to DLQ.Acknowledge the job in the main queue (so the worker is freed).Write row to ParsingDLQ.Do not retry automatically.5.2 Redrive Mechanism (The Admin Tool)An endpoint POST /admin/dlq/:id/redrive will be exposed.Admin fetches the DLQ record.Admin edits the rawPayload (fixing the typo or structure).Admin clicks "Redrive."System injects the fixed payload back into the IngestionQueue.6. Security & Privacy6.1 PII Redaction (Pre-Ingestion)Before sending any text to the SenTient external API, we run a local, regex-based PII scrubber.TypeScriptconst PII_REGEX = {
  SSN: /\d{3}-\d{2}-\d{4}/g,
  CREDIT_CARD: /\d{4}-\d{4}-\d{4}-\d{4}/g,
  EMAIL: /REDACTED_EMAIL_LOGIC/g // We keep the sender, redact others
};

function sanitize(text: string): string {
  // Replace sensitive patterns with [REDACTED]
  return text.replace(PII_REGEX.SSN, '[REDACTED-SSN]');
}
6.2 Audit LoggingEvery transformation made by the ACL must be traceable.Log Entry: Signal ID 555 processed. Mapped 'Q102' to Category 'Maintenance'. Priority elevated to HIGH due to keyword 'LEAK'.7. Implementation RoadmapPhase 1 (Skeleton): Implement ISignalIngestor interface and the ParsingDLQ database table.Phase 2 (ACL Logic): Implement the SenTientTranslationService with hardcoded mappings for testing.Phase 3 (Integration): Connect the SenTientAdapter to the live API with Circuit Breakers enabled.Phase 4 (Shadow Mode): Run SenTient in parallel with the legacy parser for 1 week. Compare results.