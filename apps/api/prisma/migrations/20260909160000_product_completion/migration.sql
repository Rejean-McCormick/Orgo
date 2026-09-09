-- AlterTable
ALTER TABLE "public"."tasks" ADD COLUMN     "access_scope_reference" TEXT,
ADD COLUMN     "access_scope_type" TEXT;

-- AlterTable
ALTER TABLE "public"."notifications" ADD COLUMN     "read_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "public"."cases" ADD COLUMN     "access_scope_reference" TEXT,
ADD COLUMN     "access_scope_type" TEXT;

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
