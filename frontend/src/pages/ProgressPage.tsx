import { IconFlame } from '../components/ui/Icons';
import { Button, ButtonLink } from '../components/ui/Button';
import { EmptyState, LoadingRow, ProgressBar } from '../components/ui/Primitives';
import { TodayPanel } from '../components/dashboard/TodayPanel';
import { PackProgressCard } from '../components/progress/PackProgressCard';
import { formatDay } from '../components/progress/TrendSparkline';
import { useAsync } from '../hooks/useAsync';
import { formatMinutes } from '../lib/studyPackRoutes';
import { progressService } from '../services/progressService';
import type {
  ProgressStats,
  StudyProgressOverview,
  TodaySummary,
  WeekSummary,
} from '../types';

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <section className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </section>
  );
}

/**
 * Progress: real study data only. Mastery comes from concepts, time from
 * active study, trends only appear once there are enough real days, and an
 * empty account says so instead of drawing a chart.
 */
export function ProgressPage() {
  const study = useAsync<StudyProgressOverview>(() => progressService.study(), []);
  const { data: legacy } = useAsync<ProgressStats>(() => progressService.get(), []);
  const { data: today } = useAsync<TodaySummary>(() => progressService.today(), []);
  const { data: week } = useAsync<WeekSummary>(() => progressService.week(), []);

  if (study.loading && !study.data) return <LoadingRow large />;
  if (study.error || !study.data) {
    return (
      <EmptyState
        title="Could not load progress"
        description={study.error ?? 'Try again in a moment.'}
        action={
          <Button variant="secondary" onClick={study.reload}>
            Try again
          </Button>
        }
      />
    );
  }

  const overview = study.data;
  const { overall, streak } = overview;

  return (
    <div className="stack progress-page" style={{ gap: 28 }}>
      <div className="page-header">
        <div>
          <h1>Progress</h1>
          <p>Honest numbers from your real study activity.</p>
        </div>
        {overview.hasActivity ? (
          <ButtonLink to="/study" size="lg">
            Continue studying
          </ButtonLink>
        ) : null}
      </div>

      {!overview.hasActivity ? (
        <EmptyState
          title="No study data yet"
          description="Finish a practice session, a test or a flashcard review and your progress shows up here. Lerno only shows what you really did."
          action={<ButtonLink to="/study">Start studying</ButtonLink>}
        />
      ) : (
        <>
          <section aria-labelledby="progress-overview-title">
            <h2 id="progress-overview-title" className="visually-hidden">
              Overview
            </h2>
            <div className="study-stats">
              <Stat
                label="Overall mastery"
                value={overall.masteryPercent === null ? '—' : `${overall.masteryPercent}%`}
                sub={
                  overall.conceptsTotal > 0
                    ? `Across ${overall.conceptsTotal} concept${overall.conceptsTotal === 1 ? '' : 's'}`
                    : 'No concepts yet'
                }
              />
              <Stat
                label="Study time"
                value={formatMinutes(overall.studyMinutes)}
                sub="Active time, idle gaps excluded"
              />
              <Stat
                label="Questions answered"
                value={String(overall.questionsAnswered)}
                sub="Practice, learn checks and tests"
              />
              <Stat label="Cards reviewed" value={String(overall.cardsReviewed)} sub="Flashcard reviews" />
              <Stat
                label="Tests completed"
                value={String(overall.testsCompleted)}
                sub={`${overall.sessionsCompleted} session${overall.sessionsCompleted === 1 ? '' : 's'} finished`}
              />
              <Stat
                label="Concepts mastered"
                value={String(overall.conceptsMastered)}
                sub={`of ${overall.conceptsTotal} · 85% or higher`}
              />
              <Stat
                label="Recent improvement"
                value={
                  overall.recentImprovement
                    ? `${overall.recentImprovement.changePercent > 0 ? '+' : ''}${overall.recentImprovement.changePercent} pts`
                    : '—'
                }
                sub={
                  overall.recentImprovement
                    ? `Mastery over the last ${overall.recentImprovement.windowDays} days`
                    : `Shown after ${overview.trendMinDays} days of study`
                }
              />
              <Stat
                label="Study streak"
                value={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`}
                sub={
                  streak.longest > 0
                    ? `Best ${streak.longest} ${streak.longest === 1 ? 'day' : 'days'} · finished sessions only`
                    : 'Finish a session to start one'
                }
              />
            </div>
          </section>

          {overall.improvedConcepts.length > 0 ? (
            <section aria-labelledby="progress-improved-title">
              <div className="section-title">
                <div>
                  <h2 id="progress-improved-title">Improved recently</h2>
                  <p className="muted">Concepts that went up in your latest sessions.</p>
                </div>
              </div>
              <ul className="progress-improved" role="list">
                {overall.improvedConcepts.slice(0, 5).map((concept) => (
                  <li key={concept.conceptId} className="card">
                    <strong>{concept.name}</strong>
                    <span className="progress-improved-change">
                      {concept.beforePercent}% → {concept.afterPercent}%
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {overview.packs.length > 0 ? (
            <section aria-labelledby="progress-packs-title">
              <div className="section-title">
                <div>
                  <h2 id="progress-packs-title">Study packs</h2>
                  <p className="muted">
                    Mastery is averaged across concepts, not cards opened. As of {formatDay(overview.today)}.
                  </p>
                </div>
              </div>
              <ul className="progress-pack-list" role="list">
                {overview.packs.map((pack) => (
                  <PackProgressCard key={pack.packId} pack={pack} />
                ))}
              </ul>
            </section>
          ) : null}

          {legacy ? (
            <section aria-labelledby="progress-cards-title" className="stack" style={{ gap: 16 }}>
              <div className="section-title">
                <div>
                  <h2 id="progress-cards-title">Flashcards and quizzes</h2>
                  <p className="muted">Spaced repetition on your sets.</p>
                </div>
              </div>
              <div className="progress-highlights">
                <section className="card stat-card progress-highlight">
                  <div className="stat-label">Cards studied</div>
                  <div className="stat-value">{legacy.cardsStudied}</div>
                  <div className="stat-sub">Unique cards with progress</div>
                  <IconFlame size={24} />
                </section>
                <section className="card stat-card">
                  <div className="stat-label">Flashcard accuracy</div>
                  <div className="stat-value">
                    {legacy.accuracy === null ? '—' : `${Math.round(legacy.accuracy * 100)}%`}
                  </div>
                  <div className="stat-sub">
                    {legacy.correctAnswers} correct · {legacy.incorrectAnswers} incorrect
                  </div>
                </section>
                <section className="card stat-card">
                  <div className="stat-label">Quiz accuracy</div>
                  <div className="stat-value">
                    {legacy.quizAccuracy === null ? '—' : `${Math.round(legacy.quizAccuracy * 100)}%`}
                  </div>
                  <div className="stat-sub">
                    {legacy.quizAttempts} quiz attempt{legacy.quizAttempts === 1 ? '' : 's'} · {legacy.dueCards} cards due
                  </div>
                </section>
              </div>
              <div className="progress-activity">
                {week ? <WeekPanel week={week} /> : null}
                {today ? <TodayPanel today={today} showAction={false} /> : null}
              </div>

              {legacy.subjectProgress.length > 0 ? (
                <div className="stack" style={{ gap: 16 }}>
                  <div className="section-title">
                    <h2>Subject progress</h2>
                  </div>
                  {legacy.subjectProgress.map((subject) => (
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
              ) : null}

              {legacy.setProgress.length > 0 ? (
                <div className="stack" style={{ gap: 16 }}>
                  <div className="section-title">
                    <h2>Set progress</h2>
                  </div>
                  {legacy.setProgress.map((set) => (
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
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
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
