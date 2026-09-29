import { IconFlame } from '../components/ui/Icons';
import { Button, ButtonLink } from '../components/ui/Button';
import { EmptyState, LoadingRow, ProgressBar } from '../components/ui/Primitives';
import { TodayPanel } from '../components/dashboard/TodayPanel';
import { useAsync } from '../hooks/useAsync';
import { progressService } from '../services/progressService';
import { studyPackService } from '../services/studyPackService';
import type { ProgressStats, StudyPackSummary, TodaySummary, WeekSummary } from '../types';

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function ProgressPage() {
  const { data, loading, error, reload } = useAsync<ProgressStats>(() => progressService.get(), []);
  const { data: today } = useAsync<TodaySummary>(() => progressService.today(), []);
  const { data: week } = useAsync<WeekSummary>(() => progressService.week(), []);
  const { data: packs } = useAsync<StudyPackSummary[]>(() => studyPackService.list(), []);

  if (loading) return <LoadingRow large />;
  if (error || !data) {
    return (
      <EmptyState
        title="Could not load progress"
        description={error ?? 'Try again in a moment.'}
        action={
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Progress</h1>
          <p>Honest numbers about your study activity.</p>
        </div>
        <ButtonLink to="/review">Go to review</ButtonLink>
      </div>

      <div className="progress-highlights">
        <section className="card stat-card progress-highlight">
          <div className="stat-label">Cards studied</div>
          <div className="stat-value">{data.cardsStudied}</div>
          <div className="stat-sub">Unique cards with progress</div>
          <IconFlame size={24} />
        </section>
        <section className="card stat-card">
          <div className="stat-label">Flashcard accuracy</div>
          <div className="stat-value">
            {data.accuracy === null ? '—' : `${Math.round(data.accuracy * 100)}%`}
          </div>
          <div className="stat-sub">
            {data.correctAnswers} correct · {data.incorrectAnswers} incorrect
          </div>
        </section>
        <section className="card stat-card">
          <div className="stat-label">Study streak</div>
          <div className="stat-value">
            {data.streakDays} <span className="stat-unit">days</span>
          </div>
          <div className="stat-sub">
            {data.longestStreak > 0
              ? `Best ${data.longestStreak} days`
              : 'Study today to start one'}
          </div>
        </section>
      </div>
      <dl className="progress-details">
        <div>
          <dt>Study time</dt>
          <dd>{formatMinutes(data.studyTimeMinutes)}</dd>
        </div>
        <div>
          <dt>Quiz attempts</dt>
          <dd>{data.quizAttempts}</dd>
        </div>
        <div>
          <dt>Quiz accuracy</dt>
          <dd>{data.quizAccuracy === null ? '—' : `${Math.round(data.quizAccuracy * 100)}%`}</dd>
        </div>
        <div>
          <dt>Due now</dt>
          <dd>{data.dueCards}</dd>
        </div>
      </dl>
      <div className="progress-activity">
        {week ? <WeekPanel week={week} /> : null}
        {today ? <TodayPanel today={today} showAction={false} /> : null}
      </div>

      {packs && packs.length > 0 ? (
        <section aria-labelledby="pack-progress-heading" className="stack" style={{ gap: 16, marginBottom: 28 }}>
          <div className="section-title">
            <div>
              <h2 id="pack-progress-heading">Study Pack mastery</h2>
              <p className="muted">Mastery is averaged across concepts, not cards opened.</p>
            </div>
          </div>
          <div className="progress-highlights">
            <section className="card stat-card">
              <div className="stat-label">Overall mastery</div>
              <div className="stat-value">
                {formatPackMastery(packs)}
              </div>
              <div className="stat-sub">Across {packs.reduce((sum, pack) => sum + pack.concepts, 0)} concepts</div>
            </section>
            <section className="card stat-card">
              <div className="stat-label">Strong concepts</div>
              <div className="stat-value">{packs.reduce((sum, pack) => sum + pack.masteredConcepts, 0)}</div>
              <div className="stat-sub">85% mastery or higher</div>
            </section>
            <section className="card stat-card">
              <div className="stat-label">Learning / weak</div>
              <div className="stat-value">
                {packs.reduce((sum, pack) => sum + pack.learningConcepts + pack.weakConcepts, 0)}
              </div>
              <div className="stat-sub">
                {packs.reduce((sum, pack) => sum + pack.weakConcepts, 0)} weak ·{' '}
                {packs.reduce((sum, pack) => sum + pack.learningConcepts, 0)} learning
              </div>
            </section>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            {packs.map((pack) => (
              <div key={pack.id} className="subject-row">
                <div className="subject-row-top">
                  <span style={{ fontWeight: 600 }}>{pack.title}</span>
                  <span className="muted" style={{ fontSize: '0.825rem' }}>
                    {pack.masteryPercent}% · {pack.masteredConcepts}/{pack.concepts} concepts mastered
                  </span>
                </div>
                <ProgressBar value={pack.masteryPercent} max={100} />
                <div className="muted" style={{ fontSize: '0.825rem', marginTop: 6 }}>
                  {pack.weakConcepts} weak · {pack.learningConcepts} learning · {pack.dueCards} cards due ·{' '}
                  {pack.practiceAnswers} questions answered · {pack.testsCompleted} tests completed
                  {pack.lastStudiedAt ? ` · last studied ${formatRelative(pack.lastStudiedAt)}` : ' · not studied yet'}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data.subjectProgress.length > 0 ? (
        <>
          <div className="section-title">
            <h2>Subject progress</h2>
          </div>
          <div className="stack" style={{ gap: 16, marginBottom: 28 }}>
            {data.subjectProgress.map((subject) => (
              <div key={subject.subjectId ?? subject.subjectName} className="subject-row">
                <div className="subject-row-top">
                  <span style={{ fontWeight: 600 }}>{subject.subjectName}</span>
                  <span className="muted" style={{ fontSize: '0.825rem' }}>
                    {subject.learnedCards} / {subject.totalCards} learned
                    {subject.accuracy !== null
                      ? ` · ${Math.round(subject.accuracy * 100)}% card accuracy`
                      : ''}
                  </span>
                </div>
                <ProgressBar value={subject.learnedCards} max={Math.max(subject.totalCards, 1)} />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {data.setProgress.length > 0 ? (
        <>
          <div className="section-title">
            <h2>Set progress</h2>
          </div>
          <div className="stack" style={{ gap: 16 }}>
            {data.setProgress.map((set) => (
              <div key={set.setId} className="subject-row">
                <div className="subject-row-top">
                  <span style={{ fontWeight: 600 }}>{set.setTitle}</span>
                  <span className="muted" style={{ fontSize: '0.825rem' }}>
                    {set.learnedCards} / {set.totalCards} learned · {set.dueCards} due
                  </span>
                </div>
                <ProgressBar value={set.learnedCards} max={Math.max(set.totalCards, 1)} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          title="No study data yet"
          description="Study a few cards and your progress will show up here."
          action={<ButtonLink to="/discover">Find a study set</ButtonLink>}
        />
      )}
    </>
  );
}

/** This week at a glance: compare against yourself, not others. */
function WeekPanel({ week }: { week: WeekSummary }) {
  return (
    <section className="card week-panel">
      <div className="section-title">
        <h2>This week</h2>
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          {week.studyDays} of 7 days active
        </span>
      </div>
      <div className="week-panel-body">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 8,
            marginBottom: 14,
          }}
        >
          {week.days.map((entry, index) => (
            <div
              key={entry.day}
              style={{ textAlign: 'center' }}
              title={`${entry.day}: ${entry.cardsTouched} cards, ${entry.quizzes} quizzes`}
            >
              <div className="muted" style={{ fontSize: '0.75rem', marginBottom: 4 }}>
                {WEEKDAY_LETTERS[index]}
              </div>
              <div
                style={{
                  height: 34,
                  borderRadius: 8,
                  background: entry.active ? 'var(--accent)' : 'var(--surface-raised)',
                  opacity: entry.active ? 0.9 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: entry.active ? 'var(--text-inverse)' : 'var(--text-muted)',
                }}
              >
                {entry.cardsTouched > 0 ? entry.cardsTouched : ''}
              </div>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: '0.875rem' }}>
          {week.cardsStudied} cards · {week.quizzesCompleted} quiz
          {week.quizzesCompleted === 1 ? '' : 'zes'}
          {week.quizAccuracy !== null
            ? ` · ${Math.round(week.quizAccuracy * 100)}% quiz accuracy`
            : ''}
          {` · ${week.studyTimeMinutes} min studying`}
        </div>
      </div>
    </section>
  );
}

function formatPackMastery(packs: StudyPackSummary[]): string {
  const conceptCount = packs.reduce((sum, pack) => sum + pack.concepts, 0);
  if (conceptCount === 0) return '—';
  const weighted = packs.reduce((sum, pack) => sum + pack.masteryPercent * pack.concepts, 0);
  return `${Math.round(weighted / conceptCount)}%`;
}

function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return 'recently';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
