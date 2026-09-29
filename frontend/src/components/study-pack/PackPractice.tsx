import { Button, ButtonLink } from '../ui/Button';
import { EmptyState } from '../ui/Primitives';
import { IconLightbulb, IconSparkles } from '../ui/Icons';
import { SessionStart } from '../study-session/SessionStart';
import { useQuestionGenerator } from './useQuestionGenerator';
import type { StudyPackDetail } from '../../types';

/**
 * Practice is a study session: one question at a time, instant feedback with the
 * explanation, the concept, the source and the mastery change. The questions are
 * chosen for the student — weak concepts, recent mistakes, what is due, the exam
 * date — and avoid what was just asked. This tab is the pre-start screen; the
 * session runs on its own page and can always be resumed.
 *
 * `review` starts a review of concepts that are due instead.
 */
export function PackPractice({
  pack,
  focusConceptId,
  review = false,
  onChanged,
}: {
  pack: StudyPackDetail;
  focusConceptId?: string;
  review?: boolean;
  onChanged: () => void;
}) {
  const { editor, generate, generating } = useQuestionGenerator(pack, onChanged, 8);

  if (editor) return <>{editor}</>;

  if (pack.counts.practiceQuestions === 0) {
    return (
      <EmptyState
        icon={<IconLightbulb />}
        title="No practice questions yet"
        description="Practice questions check whether you really understand the material. Generate them from your sources."
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
      <SessionStart pack={pack} type={review ? 'review' : 'practice'} conceptId={focusConceptId} />
      <div className="pack-session-intro-actions">
        {review ? (
          <ButtonLink to="?tab=practice" variant="secondary">
            Practice questions instead
          </ButtonLink>
        ) : (
          <ButtonLink to="?tab=test" variant="secondary">
            Take a test instead
          </ButtonLink>
        )}
        {pack.isOwner && !review ? (
          <Button variant="ghost" onClick={() => void generate()} disabled={generating}>
            <IconSparkles size={17} /> {generating ? 'Generating…' : 'Generate more questions'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
