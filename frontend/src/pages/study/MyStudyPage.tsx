import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { StudySetCard } from '../../components/ui/StudySetCard';
import {
  IconArrowRight,
  IconBook,
  IconCards,
  IconClock,
  IconLayers,
  IconLightbulb,
  IconPlus,
  IconSparkles,
} from '../../components/ui/Icons';
import { ExamBanner } from '../../components/my-study/ExamBanner';
import { SubjectsToday } from '../../components/my-study/SubjectsToday';
import { TodaySection, type FallbackAction } from '../../components/my-study/TodaySection';
import { SessionError } from '../../components/study-session/SessionCtaBar';
import { MasteryMeter } from '../../components/study-pack/PackBits';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { nextActionLink } from '../../lib/nextAction';
import { examInLabel } from '../../lib/sessionCopy';
import { normalizeToday } from '../../lib/todayPlan';
import { dashboardService } from '../../services/dashboardService';
import { studyPackService } from '../../services/studyPackService';
import { studyService } from '../../services/studyService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type {
  DashboardData,
  DueGroup,
  StudyPackSummary,
  StudyPackToday,
  StudySetSummary,
  Subject,
} from '../../types';

interface MyStudyData {
  dashboard: DashboardData;
  dueGroups: DueGroup[];
  recentSets: StudySetSummary[];
  subjects: Subject[];
  packToday: StudyPackToday | null;
  /** The plan could not be loaded (as opposed to "there is nothing to plan"). */
  todayFailed: boolean;
}

/** Most recently studied first, then the newest material. */
function byRecentActivity(a: StudyPackSummary, b: StudyPackSummary): number {
  return (
    (b.lastStudiedAt ?? '').localeCompare(a.lastStudiedAt ?? '') ||
    b.createdAt.localeCompare(a.createdAt)
  );
}

function hasStarted(pack: StudyPackSummary): boolean {
  return pack.masteryPercent > 0 || pack.dueCards > 0 || pack.weakConcepts > 0 || pack.lastStudiedAt !== null;
}

/**
 * My Study: what to do today, in which order and why. One primary action (the
 * recommended next step or the session to resume), a numbered plan behind it,
 * one line per subject, and only then the material itself.
 */
export function MyStudyPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useAsync<MyStudyData>(async () => {
    const [dashboard, dueGroups, recentSets, subjects, today] = await Promise.all([
      dashboardService.get(),
      studyService.dueGroups(),
      studySetService.listMine(),
      subjectService.list(),
      // The plan is additive: if it fails the page still works, with a clear retry.
      studyPackService
        .today()
        .then((value) => ({ value, failed: false }))
        .catch(() => ({ value: null, failed: true })),
    ]);

    return {
      dashboard,
      dueGroups,
      recentSets,
      subjects,
      packToday: today.value,
      todayFailed: today.failed,
    };
  }, []);

  if (loading && !data) return <LoadingRow large />;

  if (error || !data) {
    return (
      <EmptyState
        title="Could not load My Study"
        description={error ?? 'Try again in a moment.'}
        action={
          <div className="session-empty-actions">
            <Button onClick={reload}>Try again</Button>
            <ButtonLink to="/dashboard" variant="secondary">
              Back to home
            </ButtonLink>
          </div>
        }
      />
    );
  }

  const { dashboard, dueGroups, recentSets, subjects, packToday, todayFailed } = data;
  const today = normalizeToday(packToday);
  const next = nextActionLink(dashboard.today.continueAction);
  const totalDue = dueGroups.reduce((sum, group) => sum + group.dueCount, 0);
  const firstName = user?.profile.displayName.split(/\s+/)[0] ?? 'there';
  const packs = [...(packToday?.packs ?? [])].sort(byRecentActivity);
  const hasMaterial = packs.length > 0 || recentSets.length > 0;

  // Used only when the planner has nothing to offer: the long-standing next action.
  const fallback: FallbackAction = {
    title: dashboard.today.goalReached ? 'Today’s goal is complete.' : next.label,
    description: dashboard.continueSet
      ? `Continue with ${dashboard.continueSet.title}.`
      : totalDue > 0
        ? `${totalDue} cards are ready for review across your study packs.`
        : 'Choose a study pack or add new material to get started.',
    to: next.to,
    cta: dashboard.continueSet || totalDue > 0 ? 'Start studying' : 'Explore study packs',
  };

  return (
    <div className="stack my-study" style={{ gap: 28 }}>
      <div className="page-header">
        <div>
          <span className="eyebrow-label">My Study</span>
          <h1>Study smarter, {firstName}</h1>
          <p>Your plan for today, built from what you know and what is coming up.</p>
        </div>
        <ButtonLink to="/study-packs/new" variant="secondary">
          <IconSparkles size={17} /> Add study material
        </ButtonLink>
      </div>

      {todayFailed ? (
        <SessionError
          message="We could not load your plan for today. Your progress is safe."
          onRetry={reload}
          retryLabel="Try again"
        />
      ) : null}

      {today.exam ? <ExamBanner exam={today.exam} /> : null}

      {hasMaterial ? <TodaySection today={today} fallback={fallback} /> : null}

      <SubjectsToday subjects={packToday?.subjects ?? []} />

      {packs.length > 0 ? (
        <section aria-labelledby="my-study-packs">
          <div className="section-title">
            <div>
              <h2 id="my-study-packs">Your study packs</h2>
              <p className="muted">Open a pack to learn, practice or take a test.</p>
            </div>
            <Link to="/study-packs">
              All study packs <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="set-grid">
            {packs.slice(0, 3).map((pack) => {
              const started = hasStarted(pack);
              const exam = examInLabel(pack.examDaysLeft);
              return (
                <article key={pack.id} className="card card-interactive pack-list-card">
                  <div className="pack-list-head">
                    <span className="set-card-subject">{pack.subjectName ?? 'No subject'}</span>
                    {pack.dueCards > 0 ? <Badge variant="accent">{pack.dueCards} due</Badge> : null}
                  </div>
                  <h3 className="pack-list-title">
                    <Link to={`/study-packs/${pack.id}`}>{pack.title}</Link>
                  </h3>
                  <p className="muted pack-list-meta">
                    {pack.masteryPercent}% mastered · {pack.concepts} concepts · {pack.flashcards} cards ·{' '}
                    {pack.practiceQuestions} questions
                  </p>
                  <MasteryMeter percent={pack.masteryPercent} compact />
                  <div className="pack-list-actions">
                    <Link to={`/study-packs/${pack.id}?tab=learn`} className="btn btn-sm btn-secondary">
                      {started ? 'Continue learning' : 'Start learning'}
                    </Link>
                    <span className="muted pack-list-open">
                      {exam ??
                        (pack.weakConcepts > 0
                          ? `${pack.weakConcepts} weak concept${pack.weakConcepts === 1 ? '' : 's'}`
                          : started
                            ? 'Up to date'
                            : 'Nothing studied yet')}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {dueGroups.length > 0 ? (
        <section aria-labelledby="my-study-review">
          <div className="section-title">
            <div>
              <h2 id="my-study-review">Review queue</h2>
              <p className="muted">Flashcards that are due, straight from your sets.</p>
            </div>
            <Link to="/review">
              View review <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {dueGroups.slice(0, 6).map((group) => (
              <Link key={group.setId} to={`/sets/${group.setId}/study`} className="list-row">
                <span className="list-row-icon">
                  <IconBook size={19} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="list-row-title">{group.setTitle}</div>
                  <div className="muted" style={{ fontSize: '0.825rem' }}>
                    {group.subjectName ?? 'Independent study'}
                  </div>
                </div>
                <Badge variant="accent">{group.dueCount} due</Badge>
                <IconArrowRight size={16} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {recentSets.length > 0 ? (
        <section aria-labelledby="my-study-material">
          <div className="section-title">
            <div>
              <h2 id="my-study-material">My study material</h2>
              <p className="muted">Sets you can keep studying today.</p>
            </div>
            <Link to="/sets">
              View sets <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="set-grid">
            {recentSets.slice(0, 6).map((set) => (
              <StudySetCard key={set.id} set={set} />
            ))}
            <Link to="/study-packs/new" className="card card-interactive" style={{ minHeight: 190 }}>
              <div className="stack" style={{ gap: 10, height: '100%', justifyContent: 'center', alignItems: 'flex-start' }}>
                <span className="quick-icon quick-icon-blue">
                  <IconPlus />
                </span>
                <strong>Add study material</strong>
                <span className="muted">Turn notes or documents into a complete study pack.</span>
              </div>
            </Link>
          </div>
        </section>
      ) : null}

      {!hasMaterial ? (
        <EmptyState
          icon={<IconCards />}
          title="Start your first Study Pack"
          description="Upload your notes, import a PDF or paste text and Lerno will turn it into a complete learning system."
          action={
            <div className="session-empty-actions">
              <ButtonLink to="/study-packs/new">
                <IconSparkles size={17} /> Add study material
              </ButtonLink>
              <ButtonLink to="/sets/new" variant="secondary">
                Create a set manually
              </ButtonLink>
            </div>
          }
        />
      ) : null}

      {subjects.length > 0 ? (
        <section aria-labelledby="my-study-subjects-list">
          <div className="section-title">
            <div>
              <h2 id="my-study-subjects-list">Subjects</h2>
              <p className="muted">Open a subject to see mastery, due work and exams in one place.</p>
            </div>
            <Link to="/subjects">
              Manage subjects <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="set-grid">
            {subjects.slice(0, 6).map((subject) => (
              <Link key={subject.id} to={`/subjects/${subject.id}`} className="card card-interactive">
                <div className="set-card-top">
                  <span className="set-card-symbol">
                    <IconBook size={22} />
                  </span>
                  <Badge>{subject.setCount} packs</Badge>
                </div>
                <div className="set-card-body">
                  <span className="set-card-subject">Subject</span>
                  <h3 className="set-card-title">{subject.name}</h3>
                  <p className="set-card-desc">Open the study material for this subject.</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="quick-actions" aria-label="Study actions">
        <Link to="/study-packs">
          <span className="quick-icon">
            <IconLayers />
          </span>
          <span>
            <strong>Open study packs</strong>
            <small>See everything you are learning</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
        <Link to="/review">
          <span className="quick-icon quick-icon-warm">
            <IconClock />
          </span>
          <span>
            <strong>Review due cards</strong>
            <small>Keep spaced repetition moving</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
        <Link to="/sets/new">
          <span className="quick-icon">
            <IconPlus />
          </span>
          <span>
            <strong>Create manually</strong>
            <small>Build a study pack from scratch</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
        <Link to="/ai">
          <span className="quick-icon quick-icon-blue">
            <IconLightbulb />
          </span>
          <span>
            <strong>AI tutor</strong>
            <small>Ask Lerno about what you are studying</small>
          </span>
          <IconArrowRight size={17} />
        </Link>
      </section>
    </div>
  );
}
