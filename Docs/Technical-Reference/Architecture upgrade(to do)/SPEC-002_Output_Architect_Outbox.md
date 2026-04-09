SPEC-002: Architect Integration (Output & Expression)
Meta Field	Value
Status	DRAFT
Date	2025-12-17
Author	Senior Architect
Component	apps/api/src/modules/expression
Patterns	Transactional Outbox, Backend for Frontend (BFF), Pub/Sub, Circuit Breaker

1. Overview & Objectives
The Architect module acts as the "Voice" of Orgo. Its primary responsibility is Expression: translating rigid, deterministic system events (e.g., Task #123 created) into fluid, context-aware human communication (e.g., "Dear Jane, a high-priority safety inspection has been assigned to your sector.").

1.1 The Challenge
Current notifications are static strings. They lack context, tone, and empathy. Additionally, generating text via an LLM is slow (high latency) and unreliable (network errors), which creates the "Dual Write Problem": if we rely on a synchronous API call after a database transaction, we risk committing the data but failing to send the notification.

1.2 The Solution
We will implement the Transactional Outbox Pattern to decouple the decision to notify from the execution of the notification. This guarantees At-Least-Once delivery. We will also implement a Policy-Based Routing Engine to determine who gets notified and how (Tone/Format) based on their role.

2. Architecture & Data Flow
2.1 The Pipeline
Trigger (Core): A business action occurs (e.g., TaskService.create()).

Commit (Outbox): The Core writes the business data AND an Outbox record in the same atomic transaction.

Relay (Async): A background OutboxPoller reads pending messages.

Resolution (Routing): The NotificationRouter expands the scope (e.g., "Safety Team") into individual recipients.

Expression (Architect): The ArchitectAdapter generates the specific text for each recipient.

Transmission: The message is sent via the appropriate channel (Email/SMS/Push).

3. Reliability: The Transactional Outbox
Pattern Reference:

We use the database transaction to guarantee consistency between the "State of the System" and the "State of the Notifications."

3.1 Schema Design (Prisma)
We require a generic Outbox table capable of storing any event type.

Extrait de code

model Outbox {
  id            String   @id @default(uuid())
  aggregateType String   // e.g., "TASK", "CASE", "SYSTEM"
  aggregateId   String   // The ID of the entity changed
  eventType     String   // "TASK_CREATED", "STATUS_CHANGED"
  
  // The Payload contains EVERYTHING Architect needs to know.
  // We do NOT want to query the DB again during generation.
  payload       Json     
  
  status        OutboxStatus @default(PENDING)
  retryCount    Int          @default(0)
  createdAt     DateTime     @default(now())
  processedAt   DateTime?
  
  @@index([status, createdAt])
}

enum OutboxStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  DEAD_LETTER
}
3.2 Implementation Strategy (Atomic Writes)
The TaskService must not "fire and forget." It must "commit and continue."

TypeScript

// Core Domain Logic
async function createTask(dto: CreateTaskDTO) {
  return prisma.$transaction(async (tx) => {
    // 1. Write Business Data
    const task = await tx.task.create({ data: dto });
    
    // 2. Write Outbox Event (Same Transaction)
    await tx.outbox.create({
      data: {
        aggregateType: 'TASK',
        aggregateId: task.id,
        eventType: 'TASK_CREATED',
        payload: {
          title: task.title,
          priority: task.priority,
          assigneeId: task.assigneeId,
          // Snapshot relevant context NOW to avoid race conditions later
          contextSnapshot: {
            category: 'Plumbing',
            zone: 'B'
          }
        }
      }
    });
    
    return task;
  });
}
4. Scope Resolution & Routing Logic
Pattern Reference:

The OutboxPoller picks up the event. It does not know who to email. It asks the NotificationRouter.

4.1 The Scope Resolution Algorithm
We support dynamic scopes defined in the Charters module (Wikidata-based organizational rules).

Input: Event: SAFETY_INCIDENT, Scope: ZONE_B_MANAGER

Resolution Steps:

Charter Lookup: Query OrgGraph for nodes matching Role = Manager AND Location = Zone B. -> Result: User Alice.

Profile Lookup: Check Alice's NotificationProfile.

Preference: "SMS for Critical, Email for Routine."

Tone: "Direct, Professional."

Fan-Out: Create a specific job for Architect.

4.2 Tone & Context Injection (The Prompt Strategy)
We do not send generic prompts. We tailor the prompt based on the recipient's persona.

Recipient Role	Tone Instruction	Sample Prompt Context
Manager	Formal, Summary-Focused	"You are an assistant to a busy executive. Summarize this incident in 2 bullets. Focus on liability and timeline."
Field Tech	Direct, Action-Oriented	"You are a dispatcher. Send a short, clear directive. No fluff. Focus on location and equipment needed."
Public/Client	Empathetic, Reassuring	"You are a customer service liaison. Apologize for the inconvenience and provide a tracking link. Be warm."

5. The Architect Adapter (Output Port)
Pattern Reference:

This adapter manages the actual connection to the LLM.

5.1 Circuit Breaker Configuration
Concept:

LLMs hang. We must not let a hanging HTTP request exhaust our worker threads.

Timeout: 8000ms (Generative AI is slow, but 8s is the limit for a background job tick).

Failure Threshold: 5 consecutive errors.

Fallback Mode: If the Circuit is OPEN, the Adapter returns a pre-defined Static Template (Legacy Mode).

Why: It is better to send a boring "You have a notification" email than no email at all.

5.2 Rate Limiting (Bulkhead)
Concept:

We will use a dedicated Redis Queue (Queue:Expression) for these jobs.

Concurrency: Limited to 5 concurrent jobs.

Rationale: Prevent hitting OpenAI/Provider rate limits (429 Too Many Requests). If the system is under load, notifications will simply queue up (Backpressure) rather than crashing the ingestion pipeline.

6. Security & Privacy
6.1 PII Scrubbing (Egress Filter)
Before sending the payload to the Architect (External LLM), we must sanitize it.

TypeScript

function sanitizePayload(payload: any): any {
  // We need the data for context, but not the specific PII
  return {
    ...payload,
    userEmail: '[REDACTED]', // LLM doesn't need to know the address to write the email
    phoneNumber: '[REDACTED]',
    patientName: payload.patientName ? 'Patient X' : undefined
  };
}
6.2 Audit Trail
Every generated message is stored in the NotificationLog table.

Columns: eventId, recipientId, generatedText, promptUsed, providerModel (e.g., "gpt-4").

Purpose: If the AI hallucinates or says something offensive, we need a forensic trail to prove exactly what prompt caused it.

7. Implementation Roadmap
Phase 1 (Database): Create Outbox table and OutboxPoller service.

Phase 2 (Router): Implement the NotificationRouter to resolve simple scopes (User ID) -> Complex scopes (Group ID).

Phase 3 (Adapter): Connect ArchitectAdapter to the LLM Provider with the Circuit Breaker active.

Phase 4 (Tone Testing): A/B test different system prompts to ensure the "Field Tech" tone is actually useful and not annoying.

8. Failure Scenarios
Scenario	System Behavior	Recovery
DB Commit Fails	Transaction rolls back. No Task, No Outbox.	User retries request.
LLM Provider Down	Circuit opens. Fallback to Static Template.	Automatic reset after 60s.
Rate Limit Hit	Job fails with backoff.	BullMQ retries in 1m, 2m, 4m...
Hallucination	User reports weird text.	Admin checks Audit Log, tweaks System Prompt.