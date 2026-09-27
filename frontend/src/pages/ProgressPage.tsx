import { ButtonLink } from '../components/ui/Button';
import { EmptyState, LoadingRow, ProgressBar } from '../components/ui/Primitives';
import { useAsync } from '../hooks/useAsync';
import { progressService } from '../services/progressService';
import type { ProgressStats } from '../types';

export function ProgressPage() {
  const { data, loading, error } = useAsync<ProgressStats>(() => progressService.get(), []);

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
          <div className="stat-label">Accuracy</div>
          <div className="stat-value">
            {data.accuracy === null ? '—' : `${Math.round(data.accuracy * 100)}%`}
          </div>
          <div className="stat-sub">Across flashcard answers</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Study time</div>
          <div className="stat-value">{formatMinutes(data.studyTimeMinutes)}</div>
          <div className="stat-sub">Timed study sessions</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Streak</div>
          <div className="stat-value">{data.streakDays} 🔥</div>
          <div className="stat-sub">Consecutive study days</div>
        </div>
      </div>

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
                      ? ` · ${Math.round(subject.accuracy * 100)}% accuracy`
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

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
