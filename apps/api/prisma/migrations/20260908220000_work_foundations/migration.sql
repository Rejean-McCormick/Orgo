-- CreateEnum
CREATE TYPE "public"."SignalStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD');

-- CreateEnum
CREATE TYPE "public"."IntegrationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- DropForeignKey
ALTER TABLE "public"."workflow_instances" DROP CONSTRAINT "workflow_instances_task_id_fkey";

-- AlterTable
ALTER TABLE "public"."login_sessions" ADD COLUMN     "token_hash" TEXT;

-- AlterTable
ALTER TABLE "public"."tasks" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "public"."workflow_instances" ADD COLUMN     "resolved_actions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "signal_id" UUID,
ADD COLUMN     "workflow_version_id" UUID,
ALTER COLUMN "task_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."cases" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visibility" "public"."visibility_enum" NOT NULL DEFAULT 'INTERNAL';

-- CreateTable
CREATE TABLE "public"."signals" (
    "request_hash" TEXT NOT NULL,
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID,
    "source" "public"."task_source_enum" NOT NULL,
    "external_reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" "public"."TaskCategory" NOT NULL,
    "classification" TEXT,
    "severity" "public"."task_severity_enum" NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."SignalStatus" NOT NULL DEFAULT 'RECEIVED',
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "correlation_id" TEXT NOT NULL,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."signal_tasks" (
    "organization_id" UUID NOT NULL,
    "signal_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,

    CONSTRAINT "signal_tasks_pkey" PRIMARY KEY ("signal_id","task_id")
);

-- CreateTable
CREATE TABLE "public"."workflow_versions" (
    "id" UUID NOT NULL,
    "workflow_definition_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."idempotency_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."work_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."outbox_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),
    "lock_token" UUID,
    "last_error" TEXT,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."integration_operations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "external_reference" TEXT,
    "status" "public"."IntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "request_metadata" JSONB NOT NULL,
    "receipt" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signals_organization_id_received_at_idx" ON "public"."signals"("organization_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "signals_organization_id_source_idempotency_key_key" ON "public"."signals"("organization_id", "source", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "signals_organization_id_source_external_reference_key" ON "public"."signals"("organization_id", "source", "external_reference");

-- CreateIndex
CREATE UNIQUE INDEX "signals_organization_id_id_key" ON "public"."signals"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflow_definition_id_version_key" ON "public"."workflow_versions"("workflow_definition_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organization_id_operation_key_key" ON "public"."idempotency_records"("organization_id", "operation", "key");

-- CreateIndex
CREATE INDEX "work_events_organization_id_aggregate_type_aggregate_id_cre_idx" ON "public"."work_events"("organization_id", "aggregate_type", "aggregate_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_messages_status_available_at_idx" ON "public"."outbox_messages"("status", "available_at");

-- CreateIndex
CREATE INDEX "integration_operations_organization_id_subject_type_subject_idx" ON "public"."integration_operations"("organization_id", "subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_operations_organization_id_provider_operation_i_key" ON "public"."integration_operations"("organization_id", "provider", "operation", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_organization_id_id_key" ON "public"."user_accounts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "person_profiles_organization_id_id_key" ON "public"."person_profiles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_id_key" ON "public"."roles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "login_sessions_token_hash_key" ON "public"."login_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organization_id_id_key" ON "public"."tasks"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cases_organization_id_id_key" ON "public"."cases"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."signals" ADD CONSTRAINT "signals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."signals" ADD CONSTRAINT "signals_organization_id_case_id_fkey" FOREIGN KEY ("organization_id", "case_id") REFERENCES "public"."cases"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."signal_tasks" ADD CONSTRAINT "signal_tasks_organization_id_signal_id_fkey" FOREIGN KEY ("organization_id", "signal_id") REFERENCES "public"."signals"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."signal_tasks" ADD CONSTRAINT "signal_tasks_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."work_events" ADD CONSTRAINT "work_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."outbox_messages" ADD CONSTRAINT "outbox_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."integration_operations" ADD CONSTRAINT "integration_operations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tenant constraints also protect writes outside the application owner services.
ALTER TABLE public.tasks ADD CONSTRAINT tasks_case_tenant_fkey
  FOREIGN KEY (organization_id, case_id) REFERENCES public.cases (organization_id, id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_owner_user_tenant_fkey
  FOREIGN KEY (organization_id, owner_user_id) REFERENCES public.user_accounts (organization_id, id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_requester_tenant_fkey
  FOREIGN KEY (organization_id, requester_person_id) REFERENCES public.person_profiles (organization_id, id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_owner_role_tenant_fkey
  FOREIGN KEY (organization_id, owner_role_id) REFERENCES public.roles (organization_id, id);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_revision_nonnegative CHECK (revision >= 0);
ALTER TABLE public.cases ADD CONSTRAINT cases_revision_nonnegative CHECK (revision >= 0);
ALTER TABLE public.outbox_messages ADD CONSTRAINT outbox_lease_shape CHECK (
  (status = 'PROCESSING' AND lock_token IS NOT NULL AND locked_until IS NOT NULL)
  OR (status <> 'PROCESSING' AND lock_token IS NULL AND locked_until IS NULL)
);
CREATE FUNCTION public.orgo_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Orgo history and published versions are immutable'; END;
$$;
CREATE TRIGGER workflow_versions_immutable BEFORE UPDATE OR DELETE ON public.workflow_versions
  FOR EACH ROW EXECUTE FUNCTION public.orgo_reject_history_mutation();
CREATE TRIGGER work_events_immutable BEFORE UPDATE OR DELETE ON public.work_events
  FOR EACH ROW EXECUTE FUNCTION public.orgo_reject_history_mutation();
CREATE TRIGGER task_events_immutable BEFORE UPDATE OR DELETE ON public.task_events
  FOR EACH ROW EXECUTE FUNCTION public.orgo_reject_history_mutation();
