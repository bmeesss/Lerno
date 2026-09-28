import { useState } from 'react';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ProgressBar } from '../ui/Primitives';
import { IconArrowRight, IconChart, IconClock, IconRefresh } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService } from '../../services/studyPackService';
import { MasteryMeter, PackStat } from './PackBits';
import type { StudyPackDetail } from '../../types';

/**
 * Progress: mastery per concept, weak and strong topics, test history and the
 * study plan. This is where "how am I actually doing?" gets answered.
 */
export function PackProgress({ pack, onChanged }: { pack: StudyPackDetail; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const concepts = [...pack.concepts].sort(
    (a, b) => a.masteryPercent - b.masteryPercent || a.position - b.position,
  );
  const weak = concepts.filter((concept) => concept.attempts > 0 && concept.masteryPercent < 60);
  const strong = concepts.filter((concept) => concept.masteryPercent >= 80);
  const notStarted = concepts.filter((concept) => concept.attempts === 0);

  async function rebuildPlan() {
    if (busy) return;
    setBusy(true);
    try {
      await studyPackService.createPlan(pack.id, { minutesPerDay: 30 });
      toast.show('Study plan updated', 'success');
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not update the study plan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" style={{ gap: 20 }} aria-labelledby="pack-progress-page-heading">
      <div className="section-title">
        <div>
          <h2 id="pack-progress-page-heading">Progress</h2>
          <p className="muted">Mastery per concept, your test scores and the plan towards your exam.</p>
        </div>
        {pack.isOwner ? (
          <Button variant="secondary" onClick={() => void rebuildPlan()} disabled={busy}>
            <IconRefresh size={16} /> {busy ? 'Updating…' : pack.studyPlan ? 'Rebuild plan' : 'Build plan'}
          </Button>
        ) : null}
      </div>

      <div className="card">
        <div className="pack-stat-grid">
          <PackStat label="Mastery" value={`${pack.progress.masteryPercent}%`} sub={`${concepts.length} concepts`} />
          <PackStat
            label="Cards studied"
            value={`${pack.progress.studiedCards}/${pack.progress.totalCards}`}
            sub={`${pack.progress.dueCards} due now`}
          />
          <PackStat
            label="Practice accuracy"
            value={
              pack.progress.practiceAccuracy === null
                ? '—'
                : `${Math.round(pack.progress.practiceAccuracy * 100)}%`
            }
            sub={`${pack.progress.practiceAnswers} answers`}
          />
          <PackStat
            label="Best test score"
            value={
              pack.progress.bestTestScorePercent === null
                ? '—'
                : `${pack.progress.bestTestScorePercent}%`
            }
            sub={`${pack.progress.testAttempts} test${pack.progress.testAttempts === 1 ? '' : 's'}`}
          />
        </div>
        <div className="pack-progress-block">
          <span className="pack-label">Overall mastery</span>
          <ProgressBar value={pack.progress.masteryPercent} />
        </div>
      </div>

      <div className="pack-result-grid">
        <section className="card" aria-labelledby="pack-weak-heading">
          <h3 id="pack-weak-heading">Weak concepts ({weak.length})</h3>
          {weak.length > 0 ? (
            <ul className="pack-list">
              {weak.map((concept) => (
                <li key={concept.id} className="pack-progress-row">
                  <span>{concept.name}</span>
                  <MasteryMeter percent={concept.masteryPercent} compact />
                  <ButtonLink to={`?tab=practice&concept=${concept.id}`} size="sm" variant="secondary">
                    Practise
                  </ButtonLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No weak concepts yet — practice or take a test to find out.</p>
          )}
        </section>

        <section className="card" aria-labelledby="pack-strong-heading">
          <h3 id="pack-strong-heading">Strong concepts ({strong.length})</h3>
          {strong.length > 0 ? (
            <div className="pack-chip-row">
              {strong.map((concept) => (
                <Badge key={concept.id} variant="accent">
                  {concept.name} · {concept.masteryPercent}%
                </Badge>
              ))}
            </div>
          ) : (
            <p className="muted">Nothing mastered yet. Keep going — mastery grows with every answer.</p>
          )}
          {notStarted.length > 0 ? (
            <p className="muted">
              {notStarted.length} concept{notStarted.length === 1 ? '' : 's'} not started yet.
            </p>
          ) : null}
        </section>
      </div>

      <section className="card" aria-labelledby="pack-mastery-list">
        <div className="section-title">
          <div>
            <h2 id="pack-mastery-list">Mastery per concept</h2>
            <p className="muted">The basis for what Lerno recommends next.</p>
          </div>
        </div>
        {concepts.length > 0 ? (
          <ul className="pack-mastery-list">
            {concepts.map((concept) => (
              <li key={concept.id}>
                <div className="pack-mastery-copy">
                  <strong>{concept.name}</strong>
                  <span className="muted">
                    {concept.attempts} attempt{concept.attempts === 1 ? '' : 's'}
                    {concept.questionCount > 0 ? ` · ${concept.questionCount} questions` : ''}
                  </span>
                </div>
                <MasteryMeter percent={concept.masteryPercent} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No concepts yet"
            description="Concepts are what Lerno tracks mastery on."
            action={<ButtonLink to="?tab=concepts">Extract concepts</ButtonLink>}
          />
        )}
      </section>

      <div className="pack-result-grid">
        <section className="card" aria-labelledby="pack-test-history">
          <h3 id="pack-test-history">
            <IconChart size={17} /> Test history
          </h3>
          {pack.recentAttempts.length > 0 ? (
            <ul className="pack-attempt-list">
              {pack.recentAttempts.map((attempt) => {
                const percent = attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0;
                return (
                  <li key={attempt.id}>
                    <span className="pack-attempt-score">{percent}%</span>
                    <span className="muted">
                      {attempt.correctCount} correct · {attempt.incorrectCount} incorrect ·{' '}
                      {new Date(attempt.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No tests taken yet.</p>
          )}
        </section>

        <section className="card" aria-labelledby="pack-plan-heading">
          <h3 id="pack-plan-heading">
            <IconClock size={17} /> Study plan
          </h3>
          {pack.studyPlan ? (
            <>
              <p>{pack.studyPlan.overview}</p>
              <ol className="pack-plan-list">
                {pack.studyPlan.sessions.map((session) => (
                  <li key={session.day}>
                    <span className="pack-plan-day">Day {session.day}</span>
                    <div>
                      <strong>{session.focus}</strong>
                      <span className="muted">
                        {session.minutes} min{session.date ? ` · ${session.date}` : ''}
                      </span>
                      <ul className="pack-plan-activities">
                        {session.activities.map((activity) => (
                          <li key={activity}>{activity}</li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="muted">
              No plan yet.{' '}
              {pack.examDate
                ? 'Build one to spread the work until your exam.'
                : 'Add an exam date for a plan that counts down.'}
            </p>
          )}
          {!pack.studyPlan && pack.isOwner ? (
            <Button size="sm" onClick={() => void rebuildPlan()} disabled={busy}>
              Build study plan <IconArrowRight size={15} />
            </Button>
          ) : null}
        </section>
      </div>
    </section>
  );
}
