import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow, ProgressBar } from '../../components/ui/Primitives';
import { IconBook, IconFlame, IconQuiz } from '../../components/ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { TodayPanel } from '../../components/dashboard/TodayPanel';
import { dashboardService } from '../../services/dashboardService';
import type { DashboardData } from '../../types';

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

function DashboardContent({ data }: { data: DashboardData }) {
  return (
    <>
      {data.today.comeback ? (
        <div className="guest-banner" style={{ marginBottom: 20 }}>
          <p>{data.today.comeback.message}</p>
        </div>
      ) : null}

      <TodayPanel today={data.today} />

      <div className="dash-grid" style={{ marginBottom: 8 }}>
        <div className="card stat-card">
          <div className="stat-label">Cards due</div>
          <div className="stat-value">{data.cardsDue}</div>
          <div className="stat-sub">Waiting for review</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Streak</div>
          <div className="stat-value">
            {data.streakDays} <IconFlame size={22} />
          </div>
          <div className="stat-sub">Days in a row</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Cards studied</div>
          <div className="stat-value">{data.cardsStudied}</div>
          <div className="stat-sub">All time</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Quiz accuracy</div>
          <div className="stat-value">
            {data.quizAccuracy === null ? '—' : `${Math.round(data.quizAccuracy * 100)}%`}
          </div>
          <div className="stat-sub">
            <IconQuiz size={14} /> Across all attempts
          </div>
        </div>
      </div>

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
              <Link key={set.id} to={`/sets/${set.id}`} className="card card-interactive">
                <div className="set-card-title">{set.title}</div>
                <div className="set-card-desc">{set.description || 'No description'}</div>
                <div className="set-card-footer">
                  <span>{set.subjectName ?? 'No subject'}</span>
                  <span>{set.cardCount} cards</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      {data.subjectProgress.length > 0 ? (
        <>
          <div className="section-title">
            <h2>Subject progress</h2>
            <Link to="/progress" className="muted" style={{ fontSize: '0.875rem' }}>
              See all
            </Link>
          </div>
          <div className="stack" style={{ gap: 14 }}>
            {data.subjectProgress.slice(0, 4).map((subject) => (
              <div key={subject.subjectId ?? subject.subjectName} className="subject-row">
                <div className="subject-row-top">
                  <span style={{ fontWeight: 600 }}>{subject.subjectName}</span>
                  <span className="muted" style={{ fontSize: '0.825rem' }}>
                    {subject.learnedCards} / {subject.totalCards} learned
                  </span>
                </div>
                <ProgressBar value={subject.learnedCards} max={Math.max(subject.totalCards, 1)} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
