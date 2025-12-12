import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { CaseStatus, CaseSeverity } from '../../../orgo/types/case';

export interface CaseUser {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface CaseNote {
  id: string;
  body: string;
  createdAt: string;
  author?: CaseUser | null;
  isInternal?: boolean;
}

export interface CaseActivity {
  id: string;
  type:
    | 'status_change'
    | 'field_change'
    | 'comment'
    | 'note'
    | 'attachment'
    | 'system'
    | 'other';
  createdAt: string;
  actor?: CaseUser | null;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface CaseAttachment {
  id: string;
  fileName: string;
  url: string;
  fileSize?: number | null;
  contentType?: string | null;
  uploadedAt: string;
  uploadedBy?: CaseUser | null;
}

export interface AdminCaseOverview {
  id: string;
  externalId?: string | null;
  title: string;
  summary?: string | null;
  description?: string | null;
  status: CaseStatus;
  severity: CaseSeverity;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  slaDueAt?: string | null;
  tags?: string[];
  requester?: CaseUser | null;
  assignee?: CaseUser | null;
  teamName?: string | null;
  channel?: string | null;
  category?: string | null;
  subcategory?: string | null;
  activities?: CaseActivity[];
  notes?: CaseNote[];
  attachments?: CaseAttachment[];
}

export type ActiveTab = 'summary' | 'activity' | 'notes' | 'attachments';

export interface AdminCaseOverviewPageProps {
  /**
   * Optional caseId prop. If not provided, the component will
   * try to read `caseId` from the router params.
   */
  caseId?: string;
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error' | 'not_found';

interface PageState {
  status: LoadingState;
  data: AdminCaseOverview | null;
  error: string | null;
}

const getTabFromSearchParams = (params: URLSearchParams): ActiveTab => {
  const tab = params.get('tab');
  if (tab === 'activity' || tab === 'notes' || tab === 'attachments') {
    return tab;
  }
  return 'summary';
};

export const AdminCaseOverviewPage: React.FC<AdminCaseOverviewPageProps> = ({
  caseId: caseIdProp,
}) => {
  const { caseId: caseIdFromParams } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const caseId = caseIdProp ?? caseIdFromParams ?? '';

  const [state, setState] = useState<PageState>({
    status: caseId ? 'loading' : 'idle',
    data: null,
    error: null,
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>(() =>
    getTabFromSearchParams(searchParams),
  );
  const [reloadToken, setReloadToken] = useState<number>(0);

  useEffect(() => {
    if (!caseId) {
      setState({
        status: 'error',
        data: null,
        error: 'Missing case id.',
      });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const fetchCase = async () => {
      setState((prev) => ({
        ...prev,
        status: 'loading',
        error: null,
      }));

      try {
        // Use the canonical v3 case endpoint; adjust includes/admin scoping as needed.
        const response = await fetch(`/v3/cases/${encodeURIComponent(caseId)}`, {
          signal: controller.signal,
        });

        if (cancelled) {
          return;
        }

        if (response.status === 404) {
          setState({
            status: 'not_found',
            data: null,
            error: 'Case not found.',
          });
          return;
        }

        if (response.status === 403) {
          throw new Error('You do not have permission to view this case.');
        }

        if (!response.ok) {
          throw new Error('Unable to load case overview.');
        }

        const body = (await response.json()) as AdminCaseOverview;

        setState({
          status: 'success',
          data: body,
          error: null,
        });
      } catch (err) {
        if (cancelled || (err as any)?.name === 'AbortError') {
          return;
        }

        const message =
          err instanceof Error ? err.message : 'Unexpected error while loading case.';
        setState({
          status: 'error',
          data: null,
          error: message,
        });
      }
    };

    fetchCase();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [caseId, reloadToken]);

  const { status, data, error } = state;
  const isLoading = status === 'loading';

  const handleRetry = () => {
    setReloadToken((value) => value + 1);
  };

  const handleBack = () => {
    // Adjust destination path to match your routing.
    navigate('/admin/cases');
  };

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);

    const nextParams = new URLSearchParams(searchParams);
    if (tab === 'summary') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', tab);
    }

    setSearchParams(nextParams, { replace: true });
  };

  const title = data?.title || (caseId ? `Case ${caseId}` : 'Case overview');

  return (
    <div className="AdminCaseOverviewPage">
      <header className="AdminCaseOverviewPage__header">
        <div className="AdminCaseOverviewPage__headerTop">
          <button
            type="button"
            onClick={handleBack}
            className="AdminCaseOverviewPage__backButton"
          >
            ← Back to cases
          </button>
        </div>

        <div className="AdminCaseOverviewPage__headerMain">
          <div>
            <h1 className="AdminCaseOverviewPage__title">{title}</h1>
            {data && (
              <div className="AdminCaseOverviewPage__metaRow">
                <StatusBadge status={data.status} />
                <SeverityBadge severity={data.severity} />
                <span className="AdminCaseOverviewPage__id">#{data.id}</span>
              </div>
            )}
          </div>

          {data && (
            <div className="AdminCaseOverviewPage__headerRight">
              <HeaderMeta label="Created" value={formatDateTime(data.createdAt)} />
              <HeaderMeta label="Updated" value={formatDateTime(data.updatedAt)} />
              {data.slaDueAt && (
                <HeaderMeta label="SLA due" value={formatDateTime(data.slaDueAt)} />
              )}
              {data.closedAt && (
                <HeaderMeta label="Closed" value={formatDateTime(data.closedAt)} />
              )}
            </div>
          )}
        </div>
      </header>

      {isLoading && (
        <div className="AdminCaseOverviewPage__state AdminCaseOverviewPage__state--loading">
          Loading case…
        </div>
      )}

      {!isLoading && status === 'not_found' && (
        <div className="AdminCaseOverviewPage__state AdminCaseOverviewPage__state--empty">
          <p>Case not found.</p>
          <div className="AdminCaseOverviewPage__stateActions">
            <button type="button" onClick={handleBack}>
              Back to cases
            </button>
          </div>
        </div>
      )}

      {!isLoading && status === 'error' && error && (
        <div className="AdminCaseOverviewPage__state AdminCaseOverviewPage__state--error">
          <p>{error}</p>
          <div className="AdminCaseOverviewPage__stateActions">
            <button type="button" onClick={handleRetry}>
              Try again
            </button>
            <button type="button" onClick={handleBack}>
              Back to cases
            </button>
          </div>
        </div>
      )}

      {!isLoading && status === 'success' && data && (
        <main className="AdminCaseOverviewPage__main">
          <section className="AdminCaseOverviewPage__topGrid">
            <SectionCard title="Case details">
              <p className="AdminCaseOverviewPage__summary">
                {data.summary || data.description || 'No summary provided.'}
              </p>
              <dl className="AdminCaseOverviewPage__detailsList">
                <KeyValueRow label="External ID" value={data.externalId || '—'} />
                <KeyValueRow label="Category" value={data.category || '—'} />
                <KeyValueRow label="Subcategory" value={data.subcategory || '—'} />
                <KeyValueRow label="Channel" value={data.channel || '—'} />
                {data.tags && data.tags.length > 0 && (
                  <div className="AdminCaseOverviewPage__detailsRow">
                    <dt>Tags</dt>
                    <dd>
                      <div className="AdminCaseOverviewPage__tags">
                        {data.tags.map((tag) => (
                          <span key={tag} className="AdminCaseOverviewPage__tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </dd>
                  </div>
                )}
              </dl>
            </SectionCard>

            <SectionCard title="People">
              <div className="AdminCaseOverviewPage__people">
                <PersonRow label="Requester" user={data.requester} />
                <PersonRow label="Assignee" user={data.assignee} />
                <KeyValueRow label="Team" value={data.teamName || '—'} />
              </div>
            </SectionCard>
          </section>

          <section className="AdminCaseOverviewPage__tabsSection">
            <nav
              className="AdminCaseOverviewPage__tabs"
              aria-label="Case overview sections"
              role="tablist"
            >
              <TabButton
                label="Overview"
                isActive={activeTab === 'summary'}
                onClick={() => handleTabChange('summary')}
              />
              <TabButton
                label="Activity"
                isActive={activeTab === 'activity'}
                onClick={() => handleTabChange('activity')}
              />
              <TabButton
                label="Notes"
                isActive={activeTab === 'notes'}
                onClick={() => handleTabChange('notes')}
              />
              <TabButton
                label="Attachments"
                isActive={activeTab === 'attachments'}
                onClick={() => handleTabChange('attachments')}
              />
            </nav>

            <div className="AdminCaseOverviewPage__tabContent">
              {activeTab === 'summary' && (
                <SectionCard title="Overview">
                  <p>{data.description || data.summary || 'No additional information.'}</p>
                  <dl className="AdminCaseOverviewPage__detailsList AdminCaseOverviewPage__detailsList--twoColumn">
                    <KeyValueRow label="Status" value={formatStatus(data.status)} />
                    <KeyValueRow label="Severity" value={formatSeverity(data.severity)} />
                    <KeyValueRow
                      label="Created"
                      value={formatDateTime(data.createdAt)}
                    />
                    <KeyValueRow
                      label="Updated"
                      value={formatDateTime(data.updatedAt)}
                    />
                    <KeyValueRow
                      label="SLA due"
                      value={formatDateTime(data.slaDueAt)}
                    />
                    <KeyValueRow label="Closed" value={formatDateTime(data.closedAt)} />
                  </dl>
                </SectionCard>
              )}

              {activeTab === 'activity' && (
                <SectionCard title="Activity">
                  <ActivityList activities={data.activities || []} />
                </SectionCard>
              )}

              {activeTab === 'notes' && (
                <SectionCard title="Notes">
                  <NotesList notes={data.notes || []} />
                  {/* Hook up your note composer / editor component here */}
                </SectionCard>
              )}

              {activeTab === 'attachments' && (
                <SectionCard title="Attachments">
                  <AttachmentsList attachments={data.attachments || []} />
                </SectionCard>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
};

interface StatusBadgeProps {
  status: CaseStatus;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  return (
    <span
      className={`AdminCaseOverviewPage__status AdminCaseOverviewPage__status--${status}`}
    >
      {formatStatus(status)}
    </span>
  );
};

interface SeverityBadgeProps {
  severity: CaseSeverity;
}

const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity }) => {
  return (
    <span
      className={`AdminCaseOverviewPage__priority AdminCaseOverviewPage__priority--${severity}`}
    >
      {formatSeverity(severity)}
    </span>
  );
};

interface HeaderMetaProps {
  label: string;
  value: any;
}

const HeaderMeta: React.FC<HeaderMetaProps> = ({ label, value }) => (
  <div className="AdminCaseOverviewPage__headerMeta">
    <div className="AdminCaseOverviewPage__headerMetaLabel">{label}</div>
    <div className="AdminCaseOverviewPage__headerMetaValue">{value}</div>
  </div>
);

interface SectionCardProps {
  title: string;
  children: any;
}

const SectionCard: React.FC<SectionCardProps> = ({ title, children }) => (
  <section className="AdminCaseOverviewPage__card">
    <h2 className="AdminCaseOverviewPage__cardTitle">{title}</h2>
    <div className="AdminCaseOverviewPage__cardBody">{children}</div>
  </section>
);

interface KeyValueRowProps {
  label: string;
  value: any;
}

const KeyValueRow: React.FC<KeyValueRowProps> = ({ label, value }) => (
  <div className="AdminCaseOverviewPage__detailsRow">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

interface PersonRowProps {
  label: string;
  user?: CaseUser | null;
}

const PersonRow: React.FC<PersonRowProps> = ({ label, user }) => (
  <div className="AdminCaseOverviewPage__personRow">
    <div className="AdminCaseOverviewPage__personLabel">{label}</div>
    {user ? (
      <div className="AdminCaseOverviewPage__person">
        <Avatar name={user.name} avatarUrl={user.avatarUrl} />
        <div className="AdminCaseOverviewPage__personInfo">
          <div className="AdminCaseOverviewPage__personName">{user.name}</div>
          {user.email && (
            <div className="AdminCaseOverviewPage__personEmail">{user.email}</div>
          )}
        </div>
      </div>
    ) : (
      <div className="AdminCaseOverviewPage__personEmpty">Unassigned</div>
    )}
  </div>
);

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
}

const Avatar: React.FC<AvatarProps> = ({ name, avatarUrl }) => {
  const initial = name?.trim()?.charAt(0).toUpperCase() || '?';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="AdminCaseOverviewPage__avatar"
      />
    );
  }

  return (
    <div className="AdminCaseOverviewPage__avatar AdminCaseOverviewPage__avatar--fallback">
      {initial}
    </div>
  );
};

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ label, isActive, onClick }) => (
  <button
    type="button"
    className={`AdminCaseOverviewPage__tabButton${
      isActive ? ' AdminCaseOverviewPage__tabButton--active' : ''
    }`}
    onClick={onClick}
    role="tab"
    aria-selected={isActive}
  >
    {label}
  </button>
);

interface NotesListProps {
  notes: CaseNote[];
}

const NotesList: React.FC<NotesListProps> = ({ notes }) => {
  if (!notes.length) {
    return (
      <div className="AdminCaseOverviewPage__emptyState">
        No notes yet.
      </div>
    );
  }

  return (
    <ul className="AdminCaseOverviewPage__notesList">
      {notes.map((note) => (
        <li key={note.id} className="AdminCaseOverviewPage__noteItem">
          <div className="AdminCaseOverviewPage__noteHeader">
            <div className="AdminCaseOverviewPage__noteAuthor">
              {note.author ? (
                <>
                  <Avatar
                    name={note.author.name}
                    avatarUrl={note.author.avatarUrl}
                  />
                  <span className="AdminCaseOverviewPage__noteAuthorName">
                    {note.author.name}
                  </span>
                </>
              ) : (
                <span className="AdminCaseOverviewPage__noteAuthorName">System</span>
              )}
            </div>
            <div className="AdminCaseOverviewPage__noteMeta">
              <span className="AdminCaseOverviewPage__noteTimestamp">
                {formatDateTime(note.createdAt)}
              </span>
              {note.isInternal && (
                <span className="AdminCaseOverviewPage__noteInternalTag">
                  Internal
                </span>
              )}
            </div>
          </div>
          <div className="AdminCaseOverviewPage__noteBody">{note.body}</div>
        </li>
      ))}
    </ul>
  );
};

interface ActivityListProps {
  activities: CaseActivity[];
}

const ActivityList: React.FC<ActivityListProps> = ({ activities }) => {
  if (!activities.length) {
    return (
      <div className="AdminCaseOverviewPage__emptyState">
        No activity yet.
      </div>
    );
  }

  return (
    <ul className="AdminCaseOverviewPage__activityList">
      {activities.map((activity) => (
        <li key={activity.id} className="AdminCaseOverviewPage__activityItem">
          <div className="AdminCaseOverviewPage__activityHeader">
            <div className="AdminCaseOverviewPage__activityActor">
              {activity.actor ? (
                <>
                  <Avatar
                    name={activity.actor.name}
                    avatarUrl={activity.actor.avatarUrl}
                  />
                  <span className="AdminCaseOverviewPage__activityActorName">
                    {activity.actor.name}
                  </span>
                </>
              ) : (
                <span className="AdminCaseOverviewPage__activityActorName">
                  System
                </span>
              )}
            </div>
            <span className="AdminCaseOverviewPage__activityTimestamp">
              {formatDateTime(activity.createdAt)}
            </span>
          </div>
          <div className="AdminCaseOverviewPage__activityMessage">
            {activity.message}
          </div>
        </li>
      ))}
    </ul>
  );
};

interface AttachmentsListProps {
  attachments: CaseAttachment[];
}

const AttachmentsList: React.FC<AttachmentsListProps> = ({ attachments }) => {
  if (!attachments.length) {
    return (
      <div className="AdminCaseOverviewPage__emptyState">
        No attachments.
      </div>
    );
  }

  return (
    <ul className="AdminCaseOverviewPage__attachmentsList">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="AdminCaseOverviewPage__attachmentItem"
        >
          <div className="AdminCaseOverviewPage__attachmentMain">
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="AdminCaseOverviewPage__attachmentName"
            >
              {attachment.fileName}
            </a>
            <div className="AdminCaseOverviewPage__attachmentMeta">
              {attachment.fileSize != null && (
                <span>{formatBytes(attachment.fileSize)}</span>
              )}
              {attachment.contentType && (
                <span className="AdminCaseOverviewPage__attachmentContentType">
                  {attachment.contentType}
                </span>
              )}
            </div>
          </div>
          <div className="AdminCaseOverviewPage__attachmentFooter">
            <span>{formatDateTime(attachment.uploadedAt)}</span>
            {attachment.uploadedBy && (
              <span className="AdminCaseOverviewPage__attachmentUploader">
                by {attachment.uploadedBy.name}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
};

export function formatStatus(status: CaseStatus): string {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatSeverity(severity: CaseSeverity): string {
  const label = String(severity).toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function formatBytes(size: number): string {
  if (size === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.floor(Math.log(size) / Math.log(1024));
  const value = size / Math.pow(1024, exponent);
  return `${value.toFixed(1)} ${units[exponent]}`;
}

export default AdminCaseOverviewPage;
