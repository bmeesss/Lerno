import { ButtonLink } from '../components/ui/Button';
import { EmptyState, LoadingRow, ProgressBar } from '../components/ui/Primitives';
import { TodayPanel } from '../components/dashboard/TodayPanel';
import { useAsync } from '../hooks/useAsync';
import { progressService } from '../services/progressService';
import type { ProgressStats, TodaySummary, WeekSummary } from '../types';

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function ProgressPage() {
  const { data, loading, error } = useAsync<ProgressStats>(() => progressService.get(), []);
  const { data: today } = useAsync<TodaySummary>(() => progressService.today(), []);
  const { data: week } = useAsync<WeekSummary>(() => progressService.week(), []);

  if (loading) return <LoadingRow large />;
  if (error || !data) {
    return <EmptyState title="Could not load progress" description={error ?? 'Unknown error'} />;
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

      {today ? <TodayPanel today={today} /> : null}

      <div className="dash-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card">
          <div className="stat-label">Cards studied</div>
          <div className="stat-value">{data.cardsStudied}</div>
          <div className="stat-sub">Unique cards with progress</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Quiz attempts</div>
          <div className="stat-value">{data.quizAttempts}</div>
          <div className="stat-sub">All time</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Flashcard accuracy</div>
          <div className="stat-value">
            {data.accuracy === null ? '—' : `${Math.round(data.accuracy * 100)}%`}
          </div>
          <div className="stat-sub">
            {data.correctAnswers} correct · {data.incorrectAnswers} incorrect
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Quiz accuracy</div>
          <div className="stat-value">
            {data.quizAccuracy === null ? '—' : `${Math.round(data.quizAccuracy * 100)}%`}
          </div>
          <div className="stat-sub">{data.quizAttempts} attempts</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Due now</div>
          <div className="stat-value">{data.dueCards}</div>
          <div className="stat-sub">Cards waiting for review</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Study time</div>
          <div className="stat-value">{formatMinutes(data.studyTimeMinutes)}</div>
          <div className="stat-sub">Timed study sessions</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Streak</div>
          <div className="stat-value">{data.streakDays} 🔥</div>
          <div className="stat-sub">
            {data.longestStreak > 0
              ? `Best ${data.longestStreak} days`
              : 'Study today to start one'}
          </div>
        </div>
      </div>

      {week ? <WeekPanel week={week} /> : null}

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
    <>
      <div className="section-title">
        <h2>This week</h2>
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          {week.studyDays} of 7 days active
        </span>
      </div>
      <div className="card" style={{ marginBottom: 28 }}>
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
                  color: entry.active ? '#0c1512' : 'var(--text-muted)',
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
    </>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
