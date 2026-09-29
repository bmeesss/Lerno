import { Button } from '../ui/Button';
import { Badge, EmptyState } from '../ui/Primitives';
import { IconLightbulb, IconQuiz, IconSparkles } from '../ui/Icons';
import { SessionStart } from '../study-session/SessionStart';
import { useQuestionGenerator } from './useQuestionGenerator';
import type { StudyPackDetail, TestMode } from '../../types';

/**
 * Test is a real assessment: 10 questions, 20 questions or an exam simulation,
 * with no explanations and no mastery hints until the student hands it in. The
 * session runs on its own page (autosaved on the server); the result page shows
 * the score, what is known well, what needs practice and the recommended next
 * step. This tab is the pre-start screen plus the earlier attempts.
 */
export function PackTest({
  pack,
  mode,
  onChanged,
}: {
  pack: StudyPackDetail;
  mode?: TestMode;
  onChanged: () => void;
}) {
  const { editor, generate, generating } = useQuestionGenerator(pack, onChanged, 10);

  if (editor) return <>{editor}</>;

  if (pack.counts.practiceQuestions === 0) {
    return (
      <EmptyState
        icon={<IconQuiz />}
        title="Practice questions first"
        description="A test is built from the practice questions in this pack, so Lerno can score it and detect weak concepts."
        action={
          pack.isOwner ? (
            <Button onClick={() => void generate()} disabled={generating || pack.counts.readySources === 0}>
              <IconSparkles size={17} /> {generating ? 'Generating…' : 'Generate practice questions'}
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="stack pack-start-stack">
      <SessionStart pack={pack} type="test" mode={mode} />

      {pack.isOwner ? (
        <div className="pack-session-intro-actions">
          <Button variant="secondary" onClick={() => void generate()} disabled={generating}>
            <IconSparkles size={17} /> {generating ? 'Generating…' : 'Generate more questions'}
          </Button>
        </div>
      ) : null}

      {pack.recentAttempts.length > 0 ? (
        <section className="card" aria-labelledby="pack-test-attempts">
          <h3 id="pack-test-attempts">Previous attempts</h3>
          <ul className="pack-attempt-list">
            {pack.recentAttempts.map((attempt) => {
              const percent = attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0;
              return (
                <li key={attempt.id}>
                  <span className="pack-attempt-score">{percent}%</span>
                  <span className="muted">
                    {attempt.score}/{attempt.total} · {new Date(attempt.createdAt).toLocaleDateString()}
                  </span>
                  <Badge>{attempt.packTitle ?? 'This pack'}</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="muted">
          <IconLightbulb size={15} /> Tip: an exam simulation uses the most relevant questions in the pack.
        </p>
      )}
    </div>
  );
}
