-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "insights";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."organization_status_enum" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "public"."task_status_enum" AS ENUM ('PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'FAILED', 'ESCALATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."task_priority_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."task_severity_enum" AS ENUM ('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."visibility_enum" AS ENUM ('PUBLIC', 'INTERNAL', 'RESTRICTED', 'ANONYMISED');

-- CreateEnum
CREATE TYPE "public"."task_source_enum" AS ENUM ('email', 'api', 'manual', 'sync');

-- CreateEnum
CREATE TYPE "public"."notification_channel_enum" AS ENUM ('email', 'sms', 'in_app', 'webhook');

-- CreateEnum
CREATE TYPE "public"."TaskCategory" AS ENUM ('request', 'incident', 'update', 'report', 'distribution');

-- CreateEnum
CREATE TYPE "public"."CaseStatus" AS ENUM ('open', 'in_progress', 'resolved', 'archived');

-- CreateEnum
CREATE TYPE "public"."UserAuthProvider" AS ENUM ('local', 'sso', 'external_only');

-- CreateEnum
CREATE TYPE "public"."UserAccountStatus" AS ENUM ('active', 'invited', 'disabled');

-- CreateEnum
CREATE TYPE "public"."ConfidentialityLevel" AS ENUM ('normal', 'sensitive', 'highly_sensitive');

-- CreateEnum
CREATE TYPE "public"."CommentVisibility" AS ENUM ('internal_only', 'requester_visible', 'org_wide');

-- CreateEnum
CREATE TYPE "public"."WorkflowInstanceStatus" AS ENUM ('running', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."EscalationInstanceStatus" AS ENUM ('idle', 'scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."EscalationActionType" AS ENUM ('notify_role', 'notify_user', 'auto_reassign', 'auto_close', 'raise_severity');

-- CreateEnum
CREATE TYPE "public"."ParameterSource" AS ENUM ('default', 'org_override', 'profile', 'runtime');

-- CreateEnum
CREATE TYPE "public"."ActorType" AS ENUM ('user', 'system');

-- CreateEnum
CREATE TYPE "public"."SecurityEventType" AS ENUM ('failed_login', 'permission_escalation', 'api_abuse', 'data_export', 'config_change');

-- CreateEnum
CREATE TYPE "public"."SecuritySeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('queued', 'sent', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."OfflineNodeStatus" AS ENUM ('active', 'inactive', 'retired');

-- CreateEnum
CREATE TYPE "public"."SyncDirection" AS ENUM ('upload', 'download', 'bidirectional');

-- CreateEnum
CREATE TYPE "public"."SyncStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "public"."SyncResolutionStrategy" AS ENUM ('server_wins', 'client_wins', 'manual_review', 'merged');

-- CreateEnum
CREATE TYPE "public"."LearningGroupMemberRole" AS ENUM ('student', 'player', 'parent', 'coach', 'teacher', 'mentor');

-- CreateEnum
CREATE TYPE "public"."HrCaseStatus" AS ENUM ('open', 'under_review', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "public"."HrCaseConfidentialityLevel" AS ENUM ('sensitive', 'highly_sensitive');

-- CreateEnum
CREATE TYPE "public"."HrCaseParticipantRole" AS ENUM ('complainant', 'respondent', 'witness', 'advocate', 'other');

-- CreateEnum
CREATE TYPE "public"."MaintenanceCalendarSlotStatus" AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "public"."EmailDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "public"."EmailProcessingEventType" AS ENUM ('parsed', 'classification_succeeded', 'classification_failed', 'task_created', 'linked_to_existing_task', 'dropped');

-- CreateEnum
CREATE TYPE "public"."LoginTerminationReason" AS ENUM ('logout', 'timeout', 'forced', 'unknown');

-- CreateEnum
CREATE TYPE "public"."UserRoleScopeType" AS ENUM ('global', 'team', 'location', 'unit', 'custom');

-- CreateEnum
CREATE TYPE "public"."TaskEventType" AS ENUM ('created', 'status_changed', 'priority_changed', 'ownership_changed', 'comment_added', 'email_linked', 'escalated', 'deadline_updated', 'metadata_updated');

-- CreateEnum
CREATE TYPE "public"."TaskEventOrigin" AS ENUM ('ui', 'api', 'email', 'system_rule');

-- CreateEnum
CREATE TYPE "public"."EmailArchiveSourceType" AS ENUM ('pst', 'mbox', 'eml_folder');

-- CreateEnum
CREATE TYPE "public"."SignalStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD');

-- CreateEnum
CREATE TYPE "public"."IntegrationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "primary_domain" TEXT,
    "status" "public"."organization_status_enum" NOT NULL,
    "timezone" TEXT NOT NULL,
    "default_locale" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organization_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "profile_code" TEXT NOT NULL,
    "reactivity_profile" JSONB NOT NULL,
    "transparency_profile" JSONB NOT NULL,
    "pattern_sensitivity_profile" JSONB NOT NULL,
    "retention_profile" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "auth_provider" "public"."UserAuthProvider" NOT NULL,
    "status" "public"."UserAccountStatus" NOT NULL,
    "locale" TEXT,
    "timezone" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."person_profiles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "linked_user_id" UUID,
    "external_reference" TEXT,
    "full_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "primary_contact_email" TEXT,
    "primary_contact_phone" TEXT,
    "confidentiality_level" "public"."ConfidentialityLevel" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "person_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_system_role" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_by_user_id" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" "public"."UserRoleScopeType",
    "scope_reference" TEXT,
    "assigned_by_user_id" UUID,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."login_sessions" (
    "token_hash" TEXT,
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "terminated_at" TIMESTAMPTZ(6),
    "terminated_reason" "public"."LoginTerminationReason",
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."api_tokens" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "token_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_account_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "provider" TEXT NOT NULL,
    "connection_config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_account_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_inboxes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "inbound_email_address" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_threads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "external_thread_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email_thread_id" UUID,
    "message_id_header" TEXT,
    "from_address" TEXT NOT NULL,
    "to_addresses" TEXT[],
    "cc_addresses" TEXT[],
    "bcc_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "body_plain" TEXT,
    "body_html" TEXT,
    "direction" "public"."EmailDirection" NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "raw_headers" JSONB,
    "raw_source_location" TEXT,
    "sensitivity" "public"."ConfidentialityLevel" NOT NULL,
    "linked_task_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_attachments" (
    "id" UUID NOT NULL,
    "email_message_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_location" TEXT NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_ingestion_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "description" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "status" "public"."SyncStatus" NOT NULL,
    "message_count" INTEGER NOT NULL,
    "error_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_ingestion_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_processing_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email_message_id" UUID NOT NULL,
    "ingestion_batch_id" UUID,
    "event_type" "public"."EmailProcessingEventType" NOT NULL,
    "details" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_processing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tasks" (
    "access_scope_type" TEXT,
    "access_scope_reference" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID,
    "external_reference" TEXT,
    "type" TEXT NOT NULL,
    "category" "public"."TaskCategory" NOT NULL,
    "subtype" TEXT,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."task_status_enum" NOT NULL,
    "priority" "public"."task_priority_enum" NOT NULL,
    "severity" "public"."task_severity_enum" NOT NULL,
    "visibility" "public"."visibility_enum" NOT NULL,
    "source" "public"."task_source_enum" NOT NULL,
    "created_by_user_id" UUID,
    "requester_person_id" UUID,
    "owner_role_id" UUID,
    "owner_user_id" UUID,
    "assignee_role" TEXT,
    "reactivity_time" interval,
    "reactivity_deadline_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "escalation_level" INTEGER NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."task_assignments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "assigned_role_id" UUID,
    "assigned_user_id" UUID,
    "is_primary" BOOLEAN NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL,
    "unassigned_at" TIMESTAMPTZ(6),
    "assignment_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."task_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" "public"."TaskEventType" NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "actor_user_id" UUID,
    "actor_role_id" UUID,
    "origin" "public"."TaskEventOrigin" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."task_comments" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_user_id" UUID,
    "visibility" "public"."CommentVisibility" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."routing_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "name" TEXT NOT NULL,
    "task_type" TEXT,
    "task_category" "public"."TaskCategory",
    "label_codes" TEXT[],
    "priority_min" "public"."task_priority_enum",
    "target_role_id" UUID,
    "target_user_id" UUID,
    "is_fallback" BOOLEAN NOT NULL,
    "weight" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "definition_blob" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_instances" (
    "workflow_version_id" UUID,
    "signal_id" UUID,
    "resolved_actions" JSONB NOT NULL DEFAULT '[]',
    "id" UUID NOT NULL,
    "workflow_definition_id" UUID NOT NULL,
    "task_id" UUID,
    "organization_id" UUID NOT NULL,
    "status" "public"."WorkflowInstanceStatus" NOT NULL,
    "current_state" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_transition_events" (
    "id" UUID NOT NULL,
    "workflow_instance_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_role_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_transition_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."escalation_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "task_type" TEXT,
    "category" "public"."TaskCategory",
    "policy_code" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."escalation_instances" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "escalation_policy_id" UUID NOT NULL,
    "current_step_index" INTEGER NOT NULL,
    "status" "public"."EscalationInstanceStatus" NOT NULL,
    "next_fire_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "escalation_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."escalation_events" (
    "id" UUID NOT NULL,
    "escalation_instance_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "action_type" "public"."EscalationActionType" NOT NULL,
    "action_payload" JSONB NOT NULL,
    "executed_at" TIMESTAMPTZ(6) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "escalation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."parameter_overrides" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "module_code" TEXT NOT NULL,
    "parameter_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" "public"."ParameterSource" NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parameter_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feature_flags" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "rollout_strategy" JSONB NOT NULL,
    "enabled_from" TIMESTAMPTZ(6),
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."label_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "color_hint" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "label_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."entity_labels" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "applied_by_user_id" UUID,
    "applied_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "entity_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_templates" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "code" TEXT NOT NULL,
    "channel" "public"."notification_channel_enum" NOT NULL,
    "subject_template" TEXT,
    "body_template" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "read_at" TIMESTAMPTZ(6),
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "channel" "public"."notification_channel_enum" NOT NULL,
    "recipient_user_id" UUID,
    "recipient_address" TEXT,
    "template_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL,
    "related_task_id" UUID,
    "queued_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activity_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "actor_type" "public"."ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."security_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID,
    "event_type" "public"."SecurityEventType" NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "details" JSONB NOT NULL,
    "severity" "public"."SecuritySeverity" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."system_metric_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "metrics" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cases" (
    "access_scope_type" TEXT,
    "access_scope_reference" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "visibility" "public"."visibility_enum" NOT NULL DEFAULT 'INTERNAL',
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_type" "public"."task_source_enum" NOT NULL,
    "source_reference" TEXT,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "public"."CaseStatus" NOT NULL,
    "severity" "public"."task_severity_enum" NOT NULL,
    "reactivity_time" interval,
    "origin_vertical_level" INTEGER NOT NULL,
    "origin_role" TEXT NOT NULL,
    "tags" TEXT[],
    "location" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."maintenance_assets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_id" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."maintenance_task_links" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "asset_id" UUID,
    "organization_id" UUID NOT NULL,
    "link_type" TEXT NOT NULL,
    "priority_override" "public"."task_priority_enum",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."maintenance_calendar_slots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "asset_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "public"."MaintenanceCalendarSlotStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_calendar_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hr_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "case_code" TEXT NOT NULL,
    "confidentiality_level" "public"."HrCaseConfidentialityLevel" NOT NULL,
    "subject_person_id" UUID,
    "primary_task_id" UUID,
    "status" "public"."HrCaseStatus" NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hr_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hr_case_participants" (
    "id" UUID NOT NULL,
    "hr_case_id" UUID NOT NULL,
    "person_id" UUID,
    "role" "public"."HrCaseParticipantRole" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hr_case_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hr_case_task_links" (
    "id" UUID NOT NULL,
    "hr_case_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "link_type" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hr_case_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."wellbeing_checkins" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "case_id" UUID,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "tags" TEXT[],
    "context" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wellbeing_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."learning_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "external_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "learning_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."learning_group_memberships" (
    "id" UUID NOT NULL,
    "learning_group_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "role" "public"."LearningGroupMemberRole" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "learning_group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."education_task_links" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "learning_group_id" UUID,
    "person_id" UUID,
    "context_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "education_task_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."offline_nodes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "node_identifier" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."OfflineNodeStatus" NOT NULL,
    "last_sync_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "offline_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sync_sessions" (
    "id" UUID NOT NULL,
    "offline_node_id" UUID NOT NULL,
    "direction" "public"."SyncDirection" NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "status" "public"."SyncStatus" NOT NULL,
    "summary" JSONB NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sync_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sync_conflicts" (
    "id" UUID NOT NULL,
    "sync_session_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "server_version" JSONB NOT NULL,
    "client_version" JSONB NOT NULL,
    "resolution_strategy" "public"."SyncResolutionStrategy" NOT NULL,
    "resolved" BOOLEAN NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_archive_import_batches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_type" "public"."EmailArchiveSourceType" NOT NULL,
    "source_path" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "status" "public"."SyncStatus" NOT NULL,
    "messages_imported" INTEGER NOT NULL,
    "error_summary" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_archive_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."imported_message_mappings" (
    "id" UUID NOT NULL,
    "email_archive_import_batch_id" UUID NOT NULL,
    "external_message_identifier" TEXT NOT NULL,
    "email_message_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "imported_message_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights"."dim_dates" (
    "date_key" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "month_name" TEXT NOT NULL,
    "week_of_year" INTEGER NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "day_name" TEXT NOT NULL,
    "is_weekend" BOOLEAN NOT NULL,

    CONSTRAINT "dim_dates_pkey" PRIMARY KEY ("date_key")
);

-- CreateTable
CREATE TABLE "insights"."dim_organizations" (
    "organization_id" UUID NOT NULL,
    "org_slug" TEXT NOT NULL,
    "org_display_name" TEXT NOT NULL,
    "org_profile_code" TEXT,
    "is_active" BOOLEAN NOT NULL,

    CONSTRAINT "dim_organizations_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "insights"."dim_tasks" (
    "task_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "case_id" UUID,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subtype" TEXT,
    "priority" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "assignee_role" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "current_status" TEXT NOT NULL,

    CONSTRAINT "dim_tasks_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "insights"."dim_cases" (
    "case_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "origin_vertical_level" INTEGER NOT NULL,
    "origin_role" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "dim_cases_pkey" PRIMARY KEY ("case_id")
);

-- CreateTable
CREATE TABLE "insights"."dim_persons" (
    "person_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "external_reference" TEXT,
    "confidentiality_level" TEXT NOT NULL,

    CONSTRAINT "dim_persons_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "insights"."dim_learning_groups" (
    "learning_group_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_type" TEXT,

    CONSTRAINT "dim_learning_groups_pkey" PRIMARY KEY ("learning_group_id")
);

-- CreateTable
CREATE TABLE "insights"."fact_tasks" (
    "id" BIGSERIAL NOT NULL,
    "date_key" DATE NOT NULL,
    "task_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "resolution_time_minutes" INTEGER,

    CONSTRAINT "fact_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights"."fact_cases" (
    "id" BIGSERIAL NOT NULL,
    "date_key" DATE NOT NULL,
    "case_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "resolution_time_days" INTEGER,

    CONSTRAINT "fact_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights"."fact_wellbeing_checkins" (
    "id" BIGSERIAL NOT NULL,
    "date_key" DATE NOT NULL,
    "checkin_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fact_wellbeing_checkins_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "public"."work_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "byte_length" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "work_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."work_relations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."durable_processes" (
    "compensates_id" UUID,
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "plan_hash" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "operation_id" UUID,
    "wake_at" TIMESTAMPTZ(6),
    "results" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "actor_user_id" UUID,
    "api_token_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "durable_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."identity_challenges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "public"."worker_heartbeats" (
    "id" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inbox_emails" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "signal_id" UUID NOT NULL,
    "envelope" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sso_identities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oidc_attempts" (
    "state_hash" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "browser_hash" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "oidc_attempts_pkey" PRIMARY KEY ("state_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "public"."organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organization_profiles_organization_id_key" ON "public"."organization_profiles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_organization_id_id_key" ON "public"."user_accounts"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_organization_id_email_key" ON "public"."user_accounts"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "person_profiles_organization_id_id_key" ON "public"."person_profiles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_id_key" ON "public"."roles"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_code_key" ON "public"."roles"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "public"."permissions"("code");

-- CreateIndex
CREATE INDEX "role_permissions_role_id_idx" ON "public"."role_permissions"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "public"."role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_role_assignments_user_id_idx" ON "public"."user_role_assignments"("user_id");

-- CreateIndex
CREATE INDEX "user_role_assignments_role_id_idx" ON "public"."user_role_assignments"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "login_sessions_token_hash_key" ON "public"."login_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "login_sessions_user_id_idx" ON "public"."login_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "public"."api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "role_inboxes_organization_id_role_id_idx" ON "public"."role_inboxes"("organization_id", "role_id");

-- CreateIndex
CREATE INDEX "email_threads_organization_id_idx" ON "public"."email_threads"("organization_id");

-- CreateIndex
CREATE INDEX "email_messages_organization_id_idx" ON "public"."email_messages"("organization_id");

-- CreateIndex
CREATE INDEX "email_messages_email_thread_id_idx" ON "public"."email_messages"("email_thread_id");

-- CreateIndex
CREATE INDEX "email_messages_linked_task_id_idx" ON "public"."email_messages"("linked_task_id");

-- CreateIndex
CREATE INDEX "email_attachments_email_message_id_idx" ON "public"."email_attachments"("email_message_id");

-- CreateIndex
CREATE INDEX "email_ingestion_batches_organization_id_idx" ON "public"."email_ingestion_batches"("organization_id");

-- CreateIndex
CREATE INDEX "email_processing_events_organization_id_idx" ON "public"."email_processing_events"("organization_id");

-- CreateIndex
CREATE INDEX "email_processing_events_email_message_id_idx" ON "public"."email_processing_events"("email_message_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_idx" ON "public"."tasks"("organization_id");

-- CreateIndex
CREATE INDEX "tasks_case_id_idx" ON "public"."tasks"("case_id");

-- CreateIndex
CREATE INDEX "tasks_owner_role_id_idx" ON "public"."tasks"("owner_role_id");

-- CreateIndex
CREATE INDEX "tasks_owner_user_id_idx" ON "public"."tasks"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organization_id_id_key" ON "public"."tasks"("organization_id", "id");

-- CreateIndex
CREATE INDEX "task_assignments_task_id_idx" ON "public"."task_assignments"("task_id");

-- CreateIndex
CREATE INDEX "task_events_organization_id_task_id_idx" ON "public"."task_events"("organization_id", "task_id");

-- CreateIndex
CREATE INDEX "task_comments_task_id_idx" ON "public"."task_comments"("task_id");

-- CreateIndex
CREATE INDEX "routing_rules_organization_id_idx" ON "public"."routing_rules"("organization_id");

-- CreateIndex
CREATE INDEX "workflow_definitions_organization_id_idx" ON "public"."workflow_definitions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_definitions_organization_id_code_key" ON "public"."workflow_definitions"("organization_id", "code");

-- CreateIndex
CREATE INDEX "workflow_instances_workflow_definition_id_idx" ON "public"."workflow_instances"("workflow_definition_id");

-- CreateIndex
CREATE INDEX "workflow_instances_task_id_idx" ON "public"."workflow_instances"("task_id");

-- CreateIndex
CREATE INDEX "workflow_transition_events_workflow_instance_id_idx" ON "public"."workflow_transition_events"("workflow_instance_id");

-- CreateIndex
CREATE INDEX "workflow_transition_events_task_id_idx" ON "public"."workflow_transition_events"("task_id");

-- CreateIndex
CREATE INDEX "escalation_policies_organization_id_idx" ON "public"."escalation_policies"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_policies_organization_id_policy_code_key" ON "public"."escalation_policies"("organization_id", "policy_code");

-- CreateIndex
CREATE INDEX "escalation_instances_task_id_idx" ON "public"."escalation_instances"("task_id");

-- CreateIndex
CREATE INDEX "escalation_events_escalation_instance_id_idx" ON "public"."escalation_events"("escalation_instance_id");

-- CreateIndex
CREATE INDEX "escalation_events_task_id_idx" ON "public"."escalation_events"("task_id");

-- CreateIndex
CREATE INDEX "parameter_overrides_organization_id_idx" ON "public"."parameter_overrides"("organization_id");

-- CreateIndex
CREATE INDEX "parameter_overrides_module_code_parameter_key_idx" ON "public"."parameter_overrides"("module_code", "parameter_key");

-- CreateIndex
CREATE INDEX "feature_flags_organization_id_idx" ON "public"."feature_flags"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_organization_id_code_key" ON "public"."feature_flags"("organization_id", "code");

-- CreateIndex
CREATE INDEX "label_definitions_organization_id_idx" ON "public"."label_definitions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "label_definitions_organization_id_code_key" ON "public"."label_definitions"("organization_id", "code");

-- CreateIndex
CREATE INDEX "entity_labels_organization_id_entity_type_entity_id_idx" ON "public"."entity_labels"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "entity_labels_label_id_idx" ON "public"."entity_labels"("label_id");

-- CreateIndex
CREATE INDEX "notification_templates_organization_id_idx" ON "public"."notification_templates"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_organization_id_code_key" ON "public"."notification_templates"("organization_id", "code");

-- CreateIndex
CREATE INDEX "notifications_organization_id_idx" ON "public"."notifications"("organization_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_idx" ON "public"."notifications"("recipient_user_id");

-- CreateIndex
CREATE INDEX "notifications_related_task_id_idx" ON "public"."notifications"("related_task_id");

-- CreateIndex
CREATE INDEX "activity_logs_organization_id_idx" ON "public"."activity_logs"("organization_id");

-- CreateIndex
CREATE INDEX "activity_logs_target_type_target_id_idx" ON "public"."activity_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "security_events_organization_id_idx" ON "public"."security_events"("organization_id");

-- CreateIndex
CREATE INDEX "security_events_user_id_idx" ON "public"."security_events"("user_id");

-- CreateIndex
CREATE INDEX "system_metric_snapshots_organization_id_idx" ON "public"."system_metric_snapshots"("organization_id");

-- CreateIndex
CREATE INDEX "cases_organization_id_idx" ON "public"."cases"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "cases_organization_id_id_key" ON "public"."cases"("organization_id", "id");

-- CreateIndex
CREATE INDEX "maintenance_assets_organization_id_idx" ON "public"."maintenance_assets"("organization_id");

-- CreateIndex
CREATE INDEX "maintenance_task_links_task_id_idx" ON "public"."maintenance_task_links"("task_id");

-- CreateIndex
CREATE INDEX "maintenance_task_links_asset_id_idx" ON "public"."maintenance_task_links"("asset_id");

-- CreateIndex
CREATE INDEX "maintenance_calendar_slots_organization_id_idx" ON "public"."maintenance_calendar_slots"("organization_id");

-- CreateIndex
CREATE INDEX "maintenance_calendar_slots_asset_id_idx" ON "public"."maintenance_calendar_slots"("asset_id");

-- CreateIndex
CREATE INDEX "hr_cases_organization_id_idx" ON "public"."hr_cases"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "hr_cases_organization_id_case_code_key" ON "public"."hr_cases"("organization_id", "case_code");

-- CreateIndex
CREATE INDEX "hr_case_participants_hr_case_id_idx" ON "public"."hr_case_participants"("hr_case_id");

-- CreateIndex
CREATE INDEX "hr_case_task_links_hr_case_id_idx" ON "public"."hr_case_task_links"("hr_case_id");

-- CreateIndex
CREATE INDEX "hr_case_task_links_task_id_idx" ON "public"."hr_case_task_links"("task_id");

-- CreateIndex
CREATE INDEX "wellbeing_checkins_organization_id_idx" ON "public"."wellbeing_checkins"("organization_id");

-- CreateIndex
CREATE INDEX "wellbeing_checkins_person_id_idx" ON "public"."wellbeing_checkins"("person_id");

-- CreateIndex
CREATE INDEX "learning_groups_organization_id_idx" ON "public"."learning_groups"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_groups_organization_id_code_key" ON "public"."learning_groups"("organization_id", "code");

-- CreateIndex
CREATE INDEX "learning_group_memberships_learning_group_id_idx" ON "public"."learning_group_memberships"("learning_group_id");

-- CreateIndex
CREATE INDEX "learning_group_memberships_person_id_idx" ON "public"."learning_group_memberships"("person_id");

-- CreateIndex
CREATE INDEX "education_task_links_task_id_idx" ON "public"."education_task_links"("task_id");

-- CreateIndex
CREATE INDEX "offline_nodes_organization_id_idx" ON "public"."offline_nodes"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "offline_nodes_node_identifier_key" ON "public"."offline_nodes"("node_identifier");

-- CreateIndex
CREATE INDEX "sync_sessions_offline_node_id_idx" ON "public"."sync_sessions"("offline_node_id");

-- CreateIndex
CREATE INDEX "sync_conflicts_sync_session_id_idx" ON "public"."sync_conflicts"("sync_session_id");

-- CreateIndex
CREATE INDEX "email_archive_import_batches_organization_id_idx" ON "public"."email_archive_import_batches"("organization_id");

-- CreateIndex
CREATE INDEX "imported_message_mappings_email_archive_import_batch_id_idx" ON "public"."imported_message_mappings"("email_archive_import_batch_id");

-- CreateIndex
CREATE INDEX "imported_message_mappings_email_message_id_idx" ON "public"."imported_message_mappings"("email_message_id");

-- CreateIndex
CREATE INDEX "fact_tasks_task_id_idx" ON "insights"."fact_tasks"("task_id");

-- CreateIndex
CREATE INDEX "fact_tasks_organization_id_idx" ON "insights"."fact_tasks"("organization_id");

-- CreateIndex
CREATE INDEX "fact_cases_case_id_idx" ON "insights"."fact_cases"("case_id");

-- CreateIndex
CREATE INDEX "fact_cases_organization_id_idx" ON "insights"."fact_cases"("organization_id");

-- CreateIndex
CREATE INDEX "fact_wellbeing_checkins_organization_id_idx" ON "insights"."fact_wellbeing_checkins"("organization_id");

-- CreateIndex
CREATE INDEX "fact_wellbeing_checkins_person_id_idx" ON "insights"."fact_wellbeing_checkins"("person_id");

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
CREATE INDEX "work_attachments_organization_id_subject_type_subject_id_cr_idx" ON "public"."work_attachments"("organization_id", "subject_type", "subject_id", "created_at");

-- CreateIndex
CREATE INDEX "work_relations_organization_id_target_id_idx" ON "public"."work_relations"("organization_id", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_relations_organization_id_source_type_source_id_target_key" ON "public"."work_relations"("organization_id", "source_type", "source_id", "target_type", "target_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "durable_processes_compensates_id_key" ON "public"."durable_processes"("compensates_id");

-- CreateIndex
CREATE INDEX "durable_processes_organization_id_created_at_idx" ON "public"."durable_processes"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "durable_processes_status_updated_at_idx" ON "public"."durable_processes"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "identity_challenges_token_hash_key" ON "public"."identity_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "identity_challenges_organization_id_user_id_idx" ON "public"."identity_challenges"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_emails_signal_id_key" ON "public"."inbox_emails"("signal_id");

-- CreateIndex
CREATE INDEX "inbox_emails_organization_id_created_at_idx" ON "public"."inbox_emails"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sso_identities_organization_id_issuer_subject_key" ON "public"."sso_identities"("organization_id", "issuer", "subject");

-- AddForeignKey
ALTER TABLE "public"."organization_profiles" ADD CONSTRAINT "organization_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_accounts" ADD CONSTRAINT "user_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."person_profiles" ADD CONSTRAINT "person_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."person_profiles" ADD CONSTRAINT "person_profiles_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_role_assignments" ADD CONSTRAINT "user_role_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."login_sessions" ADD CONSTRAINT "login_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."login_sessions" ADD CONSTRAINT "login_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_tokens" ADD CONSTRAINT "api_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_tokens" ADD CONSTRAINT "api_tokens_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_account_configs" ADD CONSTRAINT "email_account_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_inboxes" ADD CONSTRAINT "role_inboxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_inboxes" ADD CONSTRAINT "role_inboxes_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_threads" ADD CONSTRAINT "email_threads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_messages" ADD CONSTRAINT "email_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_messages" ADD CONSTRAINT "email_messages_email_thread_id_fkey" FOREIGN KEY ("email_thread_id") REFERENCES "public"."email_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_messages" ADD CONSTRAINT "email_messages_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_attachments" ADD CONSTRAINT "email_attachments_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_ingestion_batches" ADD CONSTRAINT "email_ingestion_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_processing_events" ADD CONSTRAINT "email_processing_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_processing_events" ADD CONSTRAINT "email_processing_events_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_processing_events" ADD CONSTRAINT "email_processing_events_ingestion_batch_id_fkey" FOREIGN KEY ("ingestion_batch_id") REFERENCES "public"."email_ingestion_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_requester_person_id_fkey" FOREIGN KEY ("requester_person_id") REFERENCES "public"."person_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_owner_role_id_fkey" FOREIGN KEY ("owner_role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_assignments" ADD CONSTRAINT "task_assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_assignments" ADD CONSTRAINT "task_assignments_assigned_role_id_fkey" FOREIGN KEY ("assigned_role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_assignments" ADD CONSTRAINT "task_assignments_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_events" ADD CONSTRAINT "task_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_events" ADD CONSTRAINT "task_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_events" ADD CONSTRAINT "task_events_actor_role_id_fkey" FOREIGN KEY ("actor_role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_comments" ADD CONSTRAINT "task_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."routing_rules" ADD CONSTRAINT "routing_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."routing_rules" ADD CONSTRAINT "routing_rules_target_role_id_fkey" FOREIGN KEY ("target_role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."routing_rules" ADD CONSTRAINT "routing_rules_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_definitions" ADD CONSTRAINT "workflow_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_signal_id_fkey" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_workflow_definition_id_fkey" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_instances" ADD CONSTRAINT "workflow_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_transition_events" ADD CONSTRAINT "workflow_transition_events_actor_role_id_fkey" FOREIGN KEY ("actor_role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalation_policies" ADD CONSTRAINT "escalation_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalation_instances" ADD CONSTRAINT "escalation_instances_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalation_instances" ADD CONSTRAINT "escalation_instances_escalation_policy_id_fkey" FOREIGN KEY ("escalation_policy_id") REFERENCES "public"."escalation_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalation_events" ADD CONSTRAINT "escalation_events_escalation_instance_id_fkey" FOREIGN KEY ("escalation_instance_id") REFERENCES "public"."escalation_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalation_events" ADD CONSTRAINT "escalation_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."parameter_overrides" ADD CONSTRAINT "parameter_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."feature_flags" ADD CONSTRAINT "feature_flags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."label_definitions" ADD CONSTRAINT "label_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."entity_labels" ADD CONSTRAINT "entity_labels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."entity_labels" ADD CONSTRAINT "entity_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "public"."label_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."entity_labels" ADD CONSTRAINT "entity_labels_applied_by_user_id_fkey" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_templates" ADD CONSTRAINT "notification_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_related_task_id_fkey" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."login_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."security_events" ADD CONSTRAINT "security_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."system_metric_snapshots" ADD CONSTRAINT "system_metric_snapshots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cases" ADD CONSTRAINT "cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."maintenance_assets" ADD CONSTRAINT "maintenance_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."maintenance_task_links" ADD CONSTRAINT "maintenance_task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."maintenance_task_links" ADD CONSTRAINT "maintenance_task_links_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."maintenance_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."maintenance_task_links" ADD CONSTRAINT "maintenance_task_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."maintenance_calendar_slots" ADD CONSTRAINT "maintenance_calendar_slots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."maintenance_calendar_slots" ADD CONSTRAINT "maintenance_calendar_slots_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."maintenance_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_cases" ADD CONSTRAINT "hr_cases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_cases" ADD CONSTRAINT "hr_cases_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_cases" ADD CONSTRAINT "hr_cases_subject_person_id_fkey" FOREIGN KEY ("subject_person_id") REFERENCES "public"."person_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_cases" ADD CONSTRAINT "hr_cases_primary_task_id_fkey" FOREIGN KEY ("primary_task_id") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_case_participants" ADD CONSTRAINT "hr_case_participants_hr_case_id_fkey" FOREIGN KEY ("hr_case_id") REFERENCES "public"."hr_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_case_participants" ADD CONSTRAINT "hr_case_participants_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_case_task_links" ADD CONSTRAINT "hr_case_task_links_hr_case_id_fkey" FOREIGN KEY ("hr_case_id") REFERENCES "public"."hr_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_case_task_links" ADD CONSTRAINT "hr_case_task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wellbeing_checkins" ADD CONSTRAINT "wellbeing_checkins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wellbeing_checkins" ADD CONSTRAINT "wellbeing_checkins_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."wellbeing_checkins" ADD CONSTRAINT "wellbeing_checkins_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_groups" ADD CONSTRAINT "learning_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_group_memberships" ADD CONSTRAINT "learning_group_memberships_learning_group_id_fkey" FOREIGN KEY ("learning_group_id") REFERENCES "public"."learning_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."learning_group_memberships" ADD CONSTRAINT "learning_group_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."education_task_links" ADD CONSTRAINT "education_task_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."education_task_links" ADD CONSTRAINT "education_task_links_learning_group_id_fkey" FOREIGN KEY ("learning_group_id") REFERENCES "public"."learning_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."education_task_links" ADD CONSTRAINT "education_task_links_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."person_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."offline_nodes" ADD CONSTRAINT "offline_nodes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sync_sessions" ADD CONSTRAINT "sync_sessions_offline_node_id_fkey" FOREIGN KEY ("offline_node_id") REFERENCES "public"."offline_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sync_conflicts" ADD CONSTRAINT "sync_conflicts_sync_session_id_fkey" FOREIGN KEY ("sync_session_id") REFERENCES "public"."sync_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_archive_import_batches" ADD CONSTRAINT "email_archive_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."imported_message_mappings" ADD CONSTRAINT "imported_message_mappings_email_archive_import_batch_id_fkey" FOREIGN KEY ("email_archive_import_batch_id") REFERENCES "public"."email_archive_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."imported_message_mappings" ADD CONSTRAINT "imported_message_mappings_email_message_id_fkey" FOREIGN KEY ("email_message_id") REFERENCES "public"."email_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- -----------------------------------------------------------------
-- Orgo custom SQL preserved from the former migration chain
-- These invariants are not fully represented by Prisma Schema Language.
-- -----------------------------------------------------------------

-- BEGIN preserved custom SQL from apps\api\prisma\migrations\20260908220000_work_foundations\migration.sql
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
-- END preserved custom SQL from apps\api\prisma\migrations\20260908220000_work_foundations\migration.sql

-- BEGIN preserved custom SQL from apps\api\prisma\migrations\20260909160000_product_completion\migration.sql
-- Product invariants omitted by Prisma's polymorphic relation model.
ALTER TABLE work_attachments ADD CONSTRAINT attachment_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE work_attachments ADD CONSTRAINT attachment_content_check CHECK (subject_type IN ('task','case') AND byte_length BETWEEN 1 AND 1048576 AND (deleted_at IS NOT NULL OR octet_length(content)=byte_length));
ALTER TABLE work_relations ADD CONSTRAINT relation_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE work_relations ADD CONSTRAINT relation_kind_check CHECK (source_type IN ('task','case') AND target_type IN ('task','case') AND kind IN ('related','blocks','duplicates','follows') AND NOT(source_type=target_type AND source_id=target_id));
ALTER TABLE durable_processes ADD CONSTRAINT process_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE durable_processes ADD CONSTRAINT process_state_check CHECK (status IN ('RUNNING','WAITING_EXTERNAL','WAITING_HUMAN','WAITING_TIMER','BLOCKED','COMPLETED','CANCELLED') AND step_index>=0 AND revision>=0 AND subject_type IN ('task','case'));
ALTER TABLE durable_processes ADD CONSTRAINT process_compensation_fk FOREIGN KEY (compensates_id) REFERENCES durable_processes(id);
ALTER TABLE identity_challenges ADD CONSTRAINT challenge_user_tenant_fk FOREIGN KEY (organization_id,user_id) REFERENCES user_accounts(organization_id,id);
ALTER TABLE identity_challenges ADD CONSTRAINT challenge_kind_check CHECK (kind IN ('invite','reset'));
ALTER TABLE sso_identities ADD CONSTRAINT sso_user_tenant_fk FOREIGN KEY (organization_id,user_id) REFERENCES user_accounts(organization_id,id);
ALTER TABLE oidc_attempts ADD CONSTRAINT oidc_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE inbox_emails ADD CONSTRAINT email_signal_tenant_fk FOREIGN KEY (organization_id,signal_id) REFERENCES signals(organization_id,id);
ALTER TABLE rate_limit_buckets ADD CONSTRAINT rate_count_check CHECK (count>0);
ALTER TABLE tasks ADD CONSTRAINT task_access_scope_check CHECK ((access_scope_type IS NULL AND access_scope_reference IS NULL) OR (access_scope_type IN ('team','location','unit','custom') AND access_scope_reference IS NOT NULL AND length(access_scope_reference)>0));
ALTER TABLE cases ADD CONSTRAINT case_access_scope_check CHECK ((access_scope_type IS NULL AND access_scope_reference IS NULL) OR (access_scope_type IN ('team','location','unit','custom') AND access_scope_reference IS NOT NULL AND length(access_scope_reference)>0));
CREATE INDEX tasks_access_scope_idx ON tasks(organization_id,access_scope_type,access_scope_reference,status);
CREATE INDEX cases_access_scope_idx ON cases(organization_id,access_scope_type,access_scope_reference,status);
CREATE INDEX tasks_read_order_idx ON tasks(organization_id,created_at DESC,id DESC);
CREATE INDEX cases_read_order_idx ON cases(organization_id,created_at DESC,id DESC);
CREATE INDEX notifications_unread_idx ON notifications(organization_id,recipient_user_id,read_at,created_at DESC);
CREATE INDEX task_comments_page_idx ON task_comments(task_id,created_at DESC,id DESC);
CREATE INDEX task_search_document_idx ON tasks USING gin(to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'')));
CREATE UNIQUE INDEX maintenance_asset_tenant_id_key ON maintenance_assets(organization_id,id);
ALTER TABLE maintenance_calendar_slots ADD CONSTRAINT maintenance_slot_tenant_fk FOREIGN KEY(organization_id,asset_id) REFERENCES maintenance_assets(organization_id,id) NOT VALID;
ALTER TABLE maintenance_calendar_slots ADD CONSTRAINT calendar_interval_check CHECK (end_at>start_at) NOT VALID;
ALTER TABLE hr_cases ADD CONSTRAINT hr_case_work_tenant_fk FOREIGN KEY(organization_id,case_id) REFERENCES cases(organization_id,id) NOT VALID;
ALTER TABLE hr_cases ADD CONSTRAINT hr_case_subject_tenant_fk FOREIGN KEY(organization_id,subject_person_id) REFERENCES person_profiles(organization_id,id) NOT VALID;
ALTER TABLE hr_cases ADD CONSTRAINT hr_case_task_tenant_fk FOREIGN KEY(organization_id,primary_task_id) REFERENCES tasks(organization_id,id) NOT VALID;

CREATE FUNCTION protect_process_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.organization_id,NEW.subject_type,NEW.subject_id,NEW.plan,NEW.plan_hash) IS DISTINCT FROM ROW(OLD.organization_id,OLD.subject_type,OLD.subject_id,OLD.plan,OLD.plan_hash) THEN
    RAISE EXCEPTION 'A started process plan and subject are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER durable_process_plan_immutable BEFORE UPDATE ON durable_processes FOR EACH ROW EXECUTE FUNCTION protect_process_plan();

CREATE FUNCTION check_work_subject_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; subject uuid; tenant uuid;
BEGIN
  IF TG_TABLE_NAME='work_relations' THEN
    kind:=NEW.source_type; subject:=NEW.source_id;
  ELSE
    kind:=NEW.subject_type; subject:=NEW.subject_id;
  END IF;
  IF kind='task' THEN SELECT organization_id INTO tenant FROM tasks WHERE id=subject;
  ELSIF kind='case' THEN SELECT organization_id INTO tenant FROM cases WHERE id=subject;
  ELSE RAISE EXCEPTION 'Invalid Work subject kind'; END IF;
  IF tenant IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Work subject tenant mismatch'; END IF;
  IF TG_TABLE_NAME='work_relations' THEN
    tenant:=NULL;
    IF NEW.target_type='task' THEN SELECT organization_id INTO tenant FROM tasks WHERE id=NEW.target_id;
    ELSIF NEW.target_type='case' THEN SELECT organization_id INTO tenant FROM cases WHERE id=NEW.target_id;
    END IF;
    IF tenant IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'Work target tenant mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attachment_subject_tenant BEFORE INSERT OR UPDATE ON work_attachments FOR EACH ROW EXECUTE FUNCTION check_work_subject_tenant();
CREATE TRIGGER relation_subject_tenant BEFORE INSERT OR UPDATE ON work_relations FOR EACH ROW EXECUTE FUNCTION check_work_subject_tenant();
CREATE TRIGGER process_subject_tenant BEFORE INSERT OR UPDATE ON durable_processes FOR EACH ROW EXECUTE FUNCTION check_work_subject_tenant();

CREATE FUNCTION check_domain_member_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_tenant uuid; person_tenant uuid;
BEGIN
  IF NEW.person_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO person_tenant FROM person_profiles WHERE id=NEW.person_id;
  IF TG_TABLE_NAME='learning_group_memberships' THEN SELECT organization_id INTO parent_tenant FROM learning_groups WHERE id=NEW.learning_group_id;
  ELSE SELECT organization_id INTO parent_tenant FROM hr_cases WHERE id=NEW.hr_case_id; END IF;
  IF person_tenant IS NULL OR parent_tenant IS DISTINCT FROM person_tenant THEN RAISE EXCEPTION 'Domain membership tenant mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER learning_member_tenant BEFORE INSERT OR UPDATE ON learning_group_memberships FOR EACH ROW EXECUTE FUNCTION check_domain_member_tenant();
CREATE TRIGGER hr_participant_tenant BEFORE INSERT OR UPDATE ON hr_case_participants FOR EACH ROW EXECUTE FUNCTION check_domain_member_tenant();

CREATE FUNCTION protect_inbox_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.organization_id,NEW.signal_id,NEW.envelope) IS DISTINCT FROM ROW(OLD.organization_id,OLD.signal_id,OLD.envelope) THEN
    RAISE EXCEPTION 'Accepted email evidence cannot be rewritten';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inbox_envelope_immutable BEFORE UPDATE ON inbox_emails FOR EACH ROW EXECUTE FUNCTION protect_inbox_envelope();
-- END preserved custom SQL from apps\api\prisma\migrations\20260909160000_product_completion\migration.sql
