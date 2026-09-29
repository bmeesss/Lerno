import { ButtonLink } from '../ui/Button';
import { EmptyState } from '../ui/Primitives';
import { IconBook } from '../ui/Icons';
import { SessionStart } from '../study-session/SessionStart';
import type { StudyPackDetail } from '../../types';

/**
 * Learn is a study session: concept by concept, explanation → example → a short
 * check → a self-rating (Again / Hard / Good / Easy). Weak concepts come first,
 * then new, learning and due ones; mastered concepts only get a quick
 * confirmation. This tab is the pre-start screen — the session itself runs on
 * its own page and is stored on the server, so it can be resumed.
 */
export function PackLearn({
  pack,
  focusConceptId,
}: {
  pack: StudyPackDetail;
  focusConceptId?: string;
  /** Kept for the tab contract: sessions run on their own page, so nothing here changes the pack. */
  onChanged?: () => void;
}) {
  if (pack.concepts.length === 0) {
    return (
      <EmptyState
        icon={<IconBook />}
        title="Nothing to learn yet"
        description="Learn mode walks through the concepts in this pack. Extract concepts from your material first."
        action={<ButtonLink to="?tab=concepts">Open concepts</ButtonLink>}
      />
    );
  }

  return (
    <div className="stack pack-start-stack">
      <SessionStart pack={pack} type="learn" conceptId={focusConceptId} />
      <p className="muted">
        Prefer quick recall?{' '}
        <ButtonLink to="?tab=flashcards" variant="ghost" size="sm">
          Study flashcards instead
        </ButtonLink>
      </p>
    </div>
  );
}
