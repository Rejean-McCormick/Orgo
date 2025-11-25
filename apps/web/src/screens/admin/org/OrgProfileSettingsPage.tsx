// apps/web/src/screens/admin/org/OrgProfileSettingsPage.tsx

import React, { useEffect, useMemo, useState } from "react";
import {
  useOrgProfilesQuery,
  useProfilePreviewMutation,
  useUpdateServiceConfigMutation,
} from "../../../store/services/orgoApi";
import type {
  OrgProfileCode,
  OrgProfileSnapshot,
  ProfilePreviewDiff,
} from "../../../orgo/types/profile";

const PROFILE_OPTIONS: { code: OrgProfileCode; label: string; description: string }[] = [
  {
    code: "default",
    label: "Default",
    description: "Balanced defaults for reactivity, transparency, logging and pattern detection.",
  },
  {
    code: "friend_group",
    label: "Friend group",
    description: "Low-stakes group with relaxed timing and light logging.",
  },
  {
    code: "hospital",
    label: "Hospital",
    description: "Safety-critical environment with fast escalation and strict privacy.",
  },
  {
    code: "advocacy_group",
    label: "Advocacy group",
    description: "Mission-driven NGO with responsive handling and strong traceability.",
  },
  {
    code: "retail_chain",
    label: "Retail chain",
    description: "Distributed operations, store-level incidents, mixed urgency and retention.",
  },
  {
    code: "military_organization",
    label: "Military organization",
    description: "Highly sensitive context with aggressive escalation and full audit logging.",
  },
  {
    code: "environmental_group",
    label: "Environmental group",
    description: "Campaign-driven work with high pattern sensitivity and wide signalling.",
  },
  {
    code: "artist_collective",
    label: "Artist collective",
    description: "Creative group; relaxed timing, minimal logging, low pattern sensitivity.",
  },
];

/**
 * Format seconds into a coarse human-readable duration.
 */
function formatSeconds(value?: number): string {
  if (value == null) return "—";
  if (value < 60) return `${value}s`;
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}

/**
 * Small badge component for enum-like values.
 */
function Pill(props: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
      {props.children}
    </span>
  );
}

/**
 * Admin view to inspect and edit organization profiles and preview their impact.
 *
 * Assumptions (to be matched by the API implementation):
 * - useOrgProfilesQuery() returns either:
 *   - the active OrgProfileSnapshot for the current organization, or
 *   - an array of OrgProfileSnapshot, where index 0 is the active one.
 * - useProfilePreviewMutation() accepts:
 *     { organizationId, currentProfileCode, proposedProfileCode }
 *   and returns { summary, impact_bullets }.
 * - useUpdateServiceConfigMutation() accepts:
 *     { module: "org_profiles", organizationId, profileCode }
 *   and persists the change with audit logging.
 */
const OrgProfileSettingsPage: React.FC = () => {
  const { data, isLoading, isError, refetch } = useOrgProfilesQuery();

  const activeProfile: OrgProfileSnapshot | undefined = useMemo(() => {
    if (!data) return undefined;
    if (Array.isArray(data)) {
      return (data[0] ?? null) as OrgProfileSnapshot | null | undefined;
    }
    return data as OrgProfileSnapshot;
  }, [data]);

  const [selectedProfileCode, setSelectedProfileCode] = useState<OrgProfileCode | "">("");
  const [triggerPreview, { data: previewData, isLoading: isPreviewLoading }] =
    useProfilePreviewMutation();
  const [updateConfig, { isLoading: isSaving, isSuccess: isSaveSuccess, error: saveError }] =
    useUpdateServiceConfigMutation();

  const preview: ProfilePreviewDiff | undefined = previewData as ProfilePreviewDiff | undefined;

  useEffect(() => {
    if (activeProfile?.profile_code) {
      setSelectedProfileCode(activeProfile.profile_code as OrgProfileCode);
    }
  }, [activeProfile?.profile_code]);

  const organizationName =
    activeProfile?.organization_display_name ||
    activeProfile?.organization_slug ||
    "Current organization";

  const currentProfileOption = PROFILE_OPTIONS.find(
    (opt) => opt.code === activeProfile?.profile_code
  );
  const selectedProfileOption = PROFILE_OPTIONS.find((opt) => opt.code === selectedProfileCode);

  const hasChanges =
    !!activeProfile &&
    !!selectedProfileCode &&
    selectedProfileCode !== (activeProfile.profile_code as OrgProfileCode);

  const handlePreview = () => {
    if (!activeProfile || !hasChanges) return;
    triggerPreview({
      organizationId: activeProfile.organization_id,
      currentProfileCode: activeProfile.profile_code,
      proposedProfileCode: selectedProfileCode,
    });
  };

  const handleSave = () => {
    if (!activeProfile || !selectedProfileCode) return;
    updateConfig({
      module: "org_profiles",
      organizationId: activeProfile.organization_id,
      profileCode: selectedProfileCode,
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Organization profile</h1>
        <p className="text-sm text-gray-600">Loading profile…</p>
      </div>
    );
  }

  if (isError || !activeProfile) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-semibold">Organization profile</h1>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="mb-2">Could not load the organization profile.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded border px-3 py-1 text-xs font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const p = activeProfile.profile;

  return (
    <div className="p-6">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold">Organization profile</h1>
        <p className="max-w-2xl text-sm text-gray-600">
          Profiles control how quickly work escalates, who can see it, how long records are kept,
          and how sensitive pattern detection is for{" "}
          <span className="font-medium">{organizationName}</span>.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Current profile summary */}
        <section className="space-y-4 rounded-lg border bg-white p-4 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">
                Active profile archetype
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-lg font-semibold">
                  {currentProfileOption?.label || activeProfile.profile_code}
                </span>
                <Pill>{activeProfile.profile_code}</Pill>
                {typeof activeProfile.version === "number" && (
                  <span className="text-xs text-gray-500">v{activeProfile.version}</span>
                )}
              </div>
              {p.description && (
                <p className="mt-1 max-w-xl text-sm text-gray-600">{p.description}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Reactivity</p>
              <p className="mt-1 text-sm">
                First escalation in{" "}
                <span className="font-medium">{formatSeconds(p.reactivity_seconds)}</span>
              </p>
              <p className="text-xs text-gray-500">
                Max escalation: {formatSeconds(p.max_escalation_seconds)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Transparency</p>
              <p className="mt-1 text-sm">
                <Pill>{p.transparency_level || "—"}</Pill>
              </p>
              <p className="text-xs text-gray-500">
                Escalation granularity: {p.escalation_granularity || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Reviews</p>
              <p className="mt-1 text-sm">
                <Pill>{p.review_frequency || "—"}</Pill>
              </p>
              <p className="text-xs text-gray-500">
                Notification scope: {p.notification_scope || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Patterns</p>
              <p className="mt-1 text-sm">
                Sensitivity: <Pill>{p.pattern_sensitivity || "—"}</Pill>
              </p>
              <p className="text-xs text-gray-500">
                Window: {p.pattern_window_days ?? "—"} days, min events:{" "}
                {p.pattern_min_events ?? "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Logging &amp; retention</p>
              <p className="mt-1 text-sm">
                Logging: <Pill>{p.logging_level || "—"}</Pill>
              </p>
              <p className="text-xs text-gray-500">
                Log retention: {p.log_retention_days != null ? `${p.log_retention_days} days` : "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Automation</p>
              <p className="mt-1 text-sm">
                Level: <Pill>{p.automation_level || "—"}</Pill>
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Default Task metadata</p>
              <p className="mt-1 text-sm">
                Visibility:{" "}
                <Pill>{p.default_task_metadata?.visibility?.toLowerCase() || "—"}</Pill>
              </p>
              <p className="text-xs text-gray-500">
                Priority: {p.default_task_metadata?.default_priority || "—"},{" "}
                reactivity:{" "}
                {formatSeconds(p.default_task_metadata?.default_reactivity_seconds ?? undefined)}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium uppercase text-gray-500">Cyclic overview</p>
              <p className="mt-1 text-sm">
                {p.cyclic_overview?.enabled ? (
                  <Pill>enabled</Pill>
                ) : (
                  <Pill>disabled</Pill>
                )}
              </p>
              <p className="text-xs text-gray-500">
                Schedule:{" "}
                {[
                  p.cyclic_overview?.schedule?.weekly && "weekly",
                  p.cyclic_overview?.schedule?.monthly && "monthly",
                  p.cyclic_overview?.schedule?.yearly && "yearly",
                ]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Edit + preview column */}
        <section className="space-y-4 rounded-lg border bg-white p-4">
          <div>
            <p className="text-xs font-medium uppercase text-gray-500">Select profile archetype</p>
            <label className="mt-2 block text-sm">
              <span className="mb-1 block text-gray-700">Archetype</span>
              <select
                value={selectedProfileCode}
                onChange={(e) => setSelectedProfileCode(e.target.value as OrgProfileCode)}
                className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
              >
                {PROFILE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedProfileOption && (
              <p className="mt-2 text-xs text-gray-500">{selectedProfileOption.description}</p>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t pt-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePreview}
                disabled={!hasChanges || isPreviewLoading}
                className="rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-60"
              >
                {isPreviewLoading ? "Previewing…" : "Preview impact"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
              >
                {isSaving ? "Saving…" : "Apply change"}
              </button>
            </div>

            {isSaveSuccess && (
              <p className="text-xs text-green-700">
                Profile updated. New defaults will apply to future Tasks and Cases.
              </p>
            )}
            {saveError && (
              <p className="text-xs text-red-700">
                Failed to save changes. Please try again or check configuration logs.
              </p>
            )}
          </div>

          <div className="border-t pt-4">
            <p className="mb-2 text-xs font-medium uppercase text-gray-500">Preview</p>
            {!preview && !isPreviewLoading && (
              <p className="text-xs text-gray-500">
                Choose a different profile and click &ldquo;Preview impact&rdquo; to see how
                escalation, visibility, retention and patterns would change.
              </p>
            )}

            {preview && (
              <div className="space-y-2 text-xs">
                {preview.summary && <p className="text-gray-700">{preview.summary}</p>}
                {preview.impact_bullets && preview.impact_bullets.length > 0 && (
                  <ul className="list-disc space-y-1 pl-4 text-gray-700">
                    {preview.impact_bullets.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default OrgProfileSettingsPage;
