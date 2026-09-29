import { Link } from 'react-router-dom';
import { ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow, ProgressBar } from '../../components/ui/Primitives';
import { StudySetCard } from '../../components/ui/StudySetCard';
import {
  IconArrowRight,
  IconBook,
  IconCards,
  IconClock,
  IconLayers,
  IconLightbulb,
  IconPlus,
  IconQuiz,
  IconSparkles,
  IconZap,
} from '../../components/ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { dashboardService } from '../../services/dashboardService';
import { studyPackService } from '../../services/studyPackService';
import { studyService } from '../../services/studyService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import { useAuth } from '../../hooks/useAuth';
import { nextActionLink } from '../../lib/nextAction';
import { examCountdownLabel, formatExamDate, todayTaskHref } from '../../lib/studyPackRoutes';
import { MasteryMeter } from '../../components/study-pack/PackBits';
import type { DashboardData, DueGroup, StudyPackToday, StudySetSummary, Subject } from '../../types';

interface MyStudyData {
  dashboard: DashboardData;
  dueGroups: DueGroup[];
  recentSets: StudySetSummary[];
  subjects: Subject[];
  packToday: StudyPackToday | null;
}

const TASK_ICONS = {
  review: IconClock,
  learn: IconBook,
  practice: IconZap,
  test: IconQuiz,
  'add-material': IconSparkles,
} as const;

export function MyStudyPage() {
  const { user } = useAuth();
  const { data, loading, error } = useAsync<MyStudyData>(
    async () => {
      const [dashboard, dueGroups, recentSets, subjects, packToday] = await Promise.all([
        dashboardService.get(),
        studyService.dueGroups(),
        studySetService.listMine(),
        subjectService.list(),
        // Packs are additive: an empty or failing pack layer never blocks My Study.
        studyPackService.today().catch(() => null),
      ]);

      return { dashboard, dueGroups, recentSets, subjects, packToday };
    },
    [],
  );

  if (loading) return <LoadingRow large />;

  if (error || !data) {
    return (
      <EmptyState
        title="Could not load My Study"
        description={error ?? 'Try again in a moment.'}
        action={<ButtonLink to="/dashboard">Back to home</ButtonLink>}
      />
    );
  }

  const { dashboard, dueGroups, recentSets, subjects, packToday } = data;
  const next = nextActionLink(dashboard.today.continueAction);
  const totalDue = dueGroups.reduce((sum, group) => sum + group.dueCount, 0);
  const firstName = user?.profile.displayName.split(/\s+/)[0] ?? 'there';
  const tasks = packToday?.tasks ?? [];
  const packs = packToday?.packs ?? [];
  const exams = packToday?.exams ?? [];

  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="page-header">
        <div>
          <span className="eyebrow-label">My Study</span>
          <h1>Study smarter, {firstName}</h1>
          <p>Your study packs, reviews and next actions in one place.</p>
        </div>
        <ButtonLink to="/ai/studio">
          <IconSparkles size={17} /> Add study material
        </ButtonLink>
      </div>

      <section className="dashboard-overview">
        <div className="study-feature">
          <div className="study-feature-copy">
            <span className="eyebrow-label">Next up</span>
            <h2>
              {dashboard.today.goalReached ? 'Today’s goal is complete.' : next.label}
            </h2>
            <p>
              {dashboard.continueSet
                ? `Continue with ${dashboard.continueSet.title}.`
                : totalDue > 0
                  ? `${totalDue} cards are ready for review across your study packs.`
                  : 'Choose a study pack or add new material to get started.'}
            </p>
            <ButtonLink to={next.to}>
              {dashboard.continueSet || totalDue > 0 ? 'Start studying' : 'Explore study packs'}
              <IconArrowRight size={17} />
            </ButtonLink>
          </div>
          <div className="learning-illustration" aria-hidden="true">
            <div className="paper-card paper-back" />
            <div className="paper-card paper-front">
              <IconCards size={28} />
              <span>Learn · Practice · Test</span>
              <div className="paper-lines">
                <i />
                <i />
                <i />
              </div>
              <span className="paper-check">
                <IconClock size={17} /> {totalDue} cards due
              </span>
            </div>
          </div>
        </div>

        <section className="card" aria-label="Today's study progress">
          <div className="section-title">
            <div>
              <h2>Today</h2>
              <p className="muted">Keep building knowledge one session at a time.</p>
            </div>
            <Badge variant={dashboard.today.goalReached ? 'accent' : 'default'}>
              {dashboard.today.completedCards}/{dashboard.today.target}
            </Badge>
          </div>
          <ProgressBar value={dashboard.today.completedCards} max={Math.max(dashboard.today.target, 1)} />
          <div className="progress-details" style={{ marginTop: 14 }}>
            <div>
              <dt>Due now</dt>
              <dd>{dashboard.today.cardsDue}</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd>{dashboard.today.streak.current} days</dd>
            </div>
          </div>
        </section>
      </section>

      {tasks.length > 0 ? (
        <section aria-labelledby="my-study-today">
          <div className="section-title">
            <div>
              <h2 id="my-study-today">What to study today</h2>
              <p className="muted">Lerno looks at reviews, weak concepts and your exam dates.</p>
            </div>
          </div>
          <div className="today-plan">
            {tasks.map((task) => {
              const Icon = TASK_ICONS[task.type];
              return (
                <Link key={`${task.type}-${task.packId ?? 'none'}-${task.conceptId ?? ''}`} to={todayTaskHref(task)} className="card card-interactive today-plan-item">
                  <span className="quick-icon">
                    <Icon />
                  </span>
                  <div>
                    <strong>{task.label}</strong>
                    <p className="muted">{task.description}</p>
                  </div>
                  <IconArrowRight size={17} />
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {exams.length > 0 ? (
        <section aria-labelledby="my-study-exams">
          <div className="section-title">
            <div>
              <h2 id="my-study-exams">Exams coming up</h2>
              <p className="muted">Study packs count down to your exam date.</p>
            </div>
          </div>
          <div className="exam-strip">
            {exams.map((exam) => (
              <Link key={exam.packId} to={`/study-packs/${exam.packId}`} className="card card-interactive exam-card">
                <div className="exam-card-head">
                  <Badge variant={exam.daysLeft !== null && exam.daysLeft <= 7 ? 'warning' : 'default'}>
                    {examCountdownLabel(exam.daysLeft)}
                  </Badge>
                  {exam.examDate ? <span className="muted">{formatExamDate(exam.examDate)}</span> : null}
                </div>
                <strong>{exam.title}</strong>
                <MasteryMeter percent={exam.masteryPercent} compact />
                <span className="muted exam-card-meta">
                  {exam.dueCards} due · {exam.weakConcepts} weak concept
                  {exam.weakConcepts === 1 ? '' : 's'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {packs.length > 0 ? (
        <section aria-labelledby="my-study-packs">
          <div className="section-title">
            <div>
              <h2 id="my-study-packs">Study packs in progress</h2>
              <p className="muted">Continue where you left off.</p>
            </div>
            <Link to="/study-packs">
              View all <IconArrowRight size={15} />
            </Link>
          </div>
          <div className="set-grid">
            {packs.slice(0, 3).map((pack) => (
              <article key={pack.id} className="card card-interactive pack-list-card">
                <div className="pack-list-head">
                  <span className="set-card-subject">{pack.subjectName ?? 'No subject'}</span>
                  {pack.dueCards > 0 ? <Badge variant="accent">{pack.dueCards} due</Badge> : null}
                </div>
                <h3 className="pack-list-title">
                  <Link to={`/study-packs/${pack.id}`}>{pack.title}</Link>
                </h3>
                <p className="muted pack-list-meta">
                  {pack.flashcards} cards · {pack.concepts} concepts · {pack.practiceQuestions} questions
                </p>
                <MasteryMeter percent={pack.masteryPercent} compact />
                <div className="pack-list-actions">
                  <Link to={`/study-packs/${pack.id}`} className="btn btn-sm btn-primary">
                    <IconZap size={16} /> Continue
                  </Link>
                  <span className="muted pack-list-open">
                    {pack.weakConcepts > 0
                      ? `${pack.weakConcepts} weak concept${pack.weakConcepts === 1 ? '' : 's'}`
                      : 'Up to date'}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="section-title">
          <div>
            <h2>Review queue</h2>
            <p className="muted">Lerno chooses what needs your attention next.</p>
          </div>
          <Link to="/review">
            View review <IconArrowRight size={15} />
          </Link>
        </div>

        {dueGroups.length > 0 ? (
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
        ) : (
          <EmptyState
            icon={<IconClock />}
            title="Nothing is due right now"
            description="Learn something new or practice one of your study packs."
            action={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <ButtonLink to="/study-packs">Open study packs</ButtonLink>
                <ButtonLink to="/ai/studio" variant="secondary">
                  Add material
                </ButtonLink>
              </div>
            }
          />
        )}
      </section>

      <section>
        <div className="section-title">
          <div>
            <h2>My study material</h2>
            <p className="muted">Sets and packs you can keep studying today.</p>
          </div>
          <Link to="/sets">
            View sets <IconArrowRight size={15} />
          </Link>
        </div>

        {recentSets.length > 0 ? (
          <div className="set-grid">
            {recentSets.slice(0, 6).map((set) => (
              <StudySetCard key={set.id} set={set} />
            ))}
            <Link to="/ai/studio" className="card card-interactive" style={{ minHeight: 190 }}>
              <div className="stack" style={{ gap: 10, height: '100%', justifyContent: 'center', alignItems: 'flex-start' }}>
                <span className="quick-icon quick-icon-blue">
                  <IconPlus />
                </span>
                <strong>Add study material</strong>
                <span className="muted">Turn notes or documents into a complete study pack.</span>
              </div>
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={<IconCards />}
            title="Your first study pack starts here"
            description="Import your notes or create a pack manually. Lerno will keep the learning flow in one place."
            action={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <ButtonLink to="/ai/studio">
                  <IconSparkles size={17} /> Add study material
                </ButtonLink>
                <ButtonLink to="/sets/new" variant="secondary">
                  Create manually
                </ButtonLink>
              </div>
            }
          />
        )}
      </section>

      <section>
        <div className="section-title">
          <div>
            <h2>Subjects</h2>
            <p className="muted">Organize your learning without losing the study flow.</p>
          </div>
          <Link to="/subjects">
            Manage subjects <IconArrowRight size={15} />
          </Link>
        </div>

        {subjects.length > 0 ? (
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
        ) : (
          <EmptyState
            title="No subjects yet"
            description="Create subjects to keep your study packs organized."
            action={<ButtonLink to="/subjects">Create a subject</ButtonLink>}
          />
        )}
      </section>

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
