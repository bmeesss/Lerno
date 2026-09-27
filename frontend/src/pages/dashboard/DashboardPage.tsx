import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { IconBook } from '../../components/ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { TodayPanel } from '../../components/dashboard/TodayPanel';
import { dashboardService } from '../../services/dashboardService';
import type { DashboardData, StudySetSummary } from '../../types';

export function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useAsync<DashboardData>(() => dashboardService.get(), []);

  const firstName = user?.profile.displayName.split(/\s+/)[0] ?? 'there';

  return (
    <>
      <div className="greeting" style={{ marginBottom: 24 }}>
        <h1>Hi {firstName} 👋</h1>
        <p>Here is what to study today. One short session keeps the habit going.</p>
      </div>

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState
          title="Could not load your dashboard"
          description={error}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        />
      ) : data ? (
        <DashboardContent data={data} />
      ) : null}
    </>
  );
}

/**
 * Spec order: Today (with next action) → due → continue → recent → discover.
 * All-time stats live on the Progress page; the dashboard stays action-first.
 */
function DashboardContent({ data }: { data: DashboardData }) {
  return (
    <>
      {data.today.comeback ? (
        <div className="guest-banner" style={{ marginBottom: 20 }}>
          <p>{data.today.comeback.message}</p>
        </div>
      ) : null}

      <TodayPanel today={data.today} />

      {data.dueGroups.length > 0 ? (
        <>
          <div className="section-title">
            <h2>Cards due for review</h2>
            <Link to="/review" className="muted" style={{ fontSize: '0.875rem' }}>
              See all
            </Link>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {data.dueGroups.slice(0, 4).map((group) => (
              <Link key={group.setId} to={`/sets/${group.setId}`} className="list-row">
                <IconBook size={20} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{group.setTitle}</div>
                  <div className="muted" style={{ fontSize: '0.825rem' }}>
                    {group.subjectName ?? 'No subject'}
                  </div>
                </div>
                <Badge variant="accent">{group.dueCount} due</Badge>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <div className="section-title">
        <h2>Continue learning</h2>
      </div>
      {data.continueSet ? (
        <Link to={`/sets/${data.continueSet.id}`} className="card card-interactive">
          <div
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
          >
            <div>
              <div className="set-card-title">{data.continueSet.title}</div>
              <div className="muted" style={{ fontSize: '0.875rem' }}>
                {data.continueSet.subjectName ?? 'No subject'} · {data.continueSet.cardCount} cards
              </div>
            </div>
            <span className="btn btn-primary btn-sm">Continue</span>
          </div>
        </Link>
      ) : (
        <EmptyState
          title="No recent sets yet"
          description="Create your first study set or discover a public one to get started."
          action={<ButtonLink to="/sets/new">Create a study set</ButtonLink>}
        />
      )}

      {data.recentSets.length > 0 ? (
        <>
          <div className="section-title">
            <h2>Recent sets</h2>
            <Link to="/sets" className="muted" style={{ fontSize: '0.875rem' }}>
              See all
            </Link>
          </div>
          <div className="set-grid">
            {data.recentSets.slice(0, 6).map((set) => (
              <SetCard key={set.id} set={set} />
            ))}
          </div>
        </>
      ) : null}

      {data.suggestions.length > 0 ? (
        <>
          <div className="section-title">
            <h2>Discover</h2>
            <Link to="/discover" className="muted" style={{ fontSize: '0.875rem' }}>
              See all
            </Link>
          </div>
          <div className="set-grid">
            {data.suggestions.map((set) => (
              <SetCard key={set.id} set={set} />
            ))}
          </div>
        </>
      ) : null}

      <div style={{ textAlign: 'center', marginTop: 28 }}>
        <Link to="/progress" className="muted" style={{ fontSize: '0.875rem' }}>
          See all your stats →
        </Link>
      </div>
    </>
  );
}

function SetCard({ set }: { set: StudySetSummary }) {
  return (
    <Link to={`/sets/${set.id}`} className="card card-interactive">
      <div className="set-card-title">{set.title}</div>
      <div className="set-card-desc">{set.description || 'No description'}</div>
      <div className="set-card-footer">
        <span>{set.subjectName ?? 'No subject'}</span>
        <span>{set.cardCount} cards</span>
      </div>
    </Link>
  );
}
