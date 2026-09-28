import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { StudySetCard } from '../../components/ui/StudySetCard';
import {
  IconArrowRight,
  IconBook,
  IconLayers,
  IconPlus,
  IconSparkles,
} from '../../components/ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { TodayPanel } from '../../components/dashboard/TodayPanel';
import { dashboardService } from '../../services/dashboardService';
import { nextActionLink } from '../../lib/nextAction';
import type { DashboardData } from '../../types';

export function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync<DashboardData>(
    () => dashboardService.get(),
    [],
  );
  const firstName = user?.profile.displayName.split(/\s+/)[0] ?? 'there';
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: user?.profile.timezone || 'UTC',
    }).format(new Date()),
  );
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <div className="dash-hero">
        <div className="greeting">
          <div className="eyebrow-label">Make room for a little progress</div>
          <h1>
            {greeting}, {firstName}
          </h1>
          <p>Ready for your next little breakthrough?</p>
        </div>
        <span className="dashboard-date">
          {new Intl.DateTimeFormat('en', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: user?.profile.timezone || 'UTC',
          }).format(new Date())}
        </span>
      </div>
      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState
          title="Could not load your dashboard"
          description={error}
          action={
            <Button variant="secondary" onClick={reload}>
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
  const next = nextActionLink(data.today.continueAction);
  const canStudy = 'setId' in data.today.continueAction;
  const continueTitle =
    'setTitle' in data.today.continueAction
      ? data.today.continueAction.setTitle
      : data.continueSet?.title;
  return (
    <>
      {data.today.comeback && (
        <div className="guest-banner">
          <p>{data.today.comeback.message}</p>
        </div>
      )}
      <div className="dashboard-overview">
        <section className="study-feature">
          <div className="study-feature-copy">
            <span className="eyebrow-label">Your next step</span>
            <h2>
              {data.today.goalReached
                ? 'A little effort. Real progress.'
                : 'Keep your curiosity going.'}
            </h2>
            <p>
              {continueTitle ? (
                <>
                  Pick up <strong>{continueTitle}</strong> and make a little more of it stick.
                </>
              ) : (
                'One focused session is a good place to start. Your future self will thank you.'
              )}
            </p>
            <ButtonLink to={next.to}>
              {canStudy ? 'Continue studying' : next.label}
              <IconArrowRight size={17} />
            </ButtonLink>
            {canStudy && <span className="feature-caption">{next.label}</span>}
          </div>
          <div className="learning-illustration" aria-hidden="true">
            <div className="paper-card paper-back" />
            <div className="paper-card paper-front">
              <IconLayers size={28} />
              <span>A little every day.</span>
              <div className="paper-lines">
                <i />
                <i />
                <i />
              </div>
              <span className="paper-check">
                <IconBook size={17} /> Learn at your pace
              </span>
            </div>
          </div>
        </section>
        <TodayPanel today={data.today} showAction={false} />
      </div>
      <nav className="quick-actions" aria-label="Quick actions">
        <Link to="/sets/new">
          <span className="quick-icon">
            <IconPlus />
          </span>
          <span>
            <strong>Create a set</strong>
            <small>Give your notes a new life</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
        <Link to="/ai">
          <span className="quick-icon quick-icon-blue">
            <IconSparkles />
          </span>
          <span>
            <strong>Ask Lerno AI</strong>
            <small>A fresh way to understand</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
        <Link to="/review">
          <span className="quick-icon quick-icon-warm">
            <IconBook />
          </span>
          <span>
            <strong>Start studying</strong>
            <small>A little practice goes a long way</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
      </nav>
      <div className="dashboard-lower">
        <section>
          <div className="section-title">
            <h2>Your recent sets</h2>
            <Link to="/sets">
              View library <IconArrowRight size={15} />
            </Link>
          </div>
          {data.recentSets.length ? (
            <div className="set-grid">
              {data.recentSets.slice(0, 4).map((set) => (
                <StudySetCard key={set.id} set={set} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<IconLayers />}
              title="Your learning starts here"
              description="Create a set from your notes or find something that sparks your curiosity."
              action={<ButtonLink to="/sets/new">Create a study set</ButtonLink>}
            />
          )}
        </section>
        <aside className="review-panel">
          <div className="section-title">
            <h2>Up next</h2>
            <Badge>{data.cardsDue} due</Badge>
          </div>
          {data.dueGroups.length ? (
            <div className="review-list">
              {data.dueGroups.slice(0, 4).map((group) => (
                <Link key={group.setId} to={`/sets/${group.setId}/study`} className="review-item">
                  <span className="list-row-icon">
                    <IconBook size={18} />
                  </span>
                  <span className="review-item-copy">
                    <strong>{group.setTitle}</strong>
                    <small>
                      {group.subjectName ?? 'Independent study'} · {group.dueCount} due
                    </small>
                  </span>
                  <IconArrowRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="review-clear">
              <IconBook size={28} />
              <h3>A little breathing room</h3>
              <p>No cards due right now. Explore a new set or revisit a favorite.</p>
            </div>
          )}
          <Link className="review-all" to="/review">
            Open your review queue <IconArrowRight size={16} />
          </Link>
          <div className="progress-note">
            <IconLayers size={20} />
            <div>
              <strong>Progress, not perfection.</strong>
              <p>Build a habit that works for you.</p>
              <Link to="/progress">See your progress →</Link>
            </div>
          </div>
        </aside>
      </div>
      {data.suggestions.length > 0 && (
        <section>
          <div className="section-title">
            <h2>A little more to explore</h2>
            <Link to="/discover">
              Discover sets <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="set-grid">
            {data.suggestions.slice(0, 3).map((set) => (
              <StudySetCard key={set.id} set={set} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
