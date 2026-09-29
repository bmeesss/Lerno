import { Link } from 'react-router-dom';
import { ButtonLink } from '../ui/Button';
import { Badge } from '../ui/Primitives';
import { IconBook, IconCards, IconQuiz, IconSparkles, IconZap } from '../ui/Icons';
import { recommendedHref } from '../../lib/studyPackRoutes';
import type { StudyPackDetail } from '../../types';

/**
 * A pack that has never been studied yet gets a start state instead of an empty
 * overview: what is inside it, one recommended first step ("Start Learn") and the
 * other ways in. Real counts only — no badges for things that do not exist.
 */
export function PackGettingStarted({ pack }: { pack: StudyPackDetail }) {
  const pages = pack.sources.reduce((total, source) => total + (source.pageCount ?? 0), 0);
  const learnHref = recommendedHref(pack, { ...pack.recommended, type: 'learn' });

  return (
    <section className="card pack-getting-started" aria-labelledby="pack-getting-started-heading">
      <span className="eyebrow-label">Your Study Pack is ready</span>
      <h2 id="pack-getting-started-heading">{pack.title}</h2>
      <p>
        Lerno turned your material into a complete learning system
        {pack.subjectName ? ` for ${pack.subjectName}` : ''}
        {pack.level ? ` · ${pack.level}` : ''}.
      </p>

      <ul className="pack-getting-started-facts">
        {pages > 0 ? (
          <li>
            <strong>{pages}</strong> page{pages === 1 ? '' : 's'}
          </li>
        ) : null}
        <li>
          <strong>{pack.counts.concepts}</strong> concept{pack.counts.concepts === 1 ? '' : 's'}
        </li>
        <li>
          <strong>{pack.counts.flashcards}</strong> flashcard{pack.counts.flashcards === 1 ? '' : 's'}
        </li>
        <li>
          <strong>{pack.counts.practiceQuestions}</strong> practice question
          {pack.counts.practiceQuestions === 1 ? '' : 's'}
        </li>
      </ul>

      {!pack.aiAvailable ? (
        <div className="import-notice">
          <IconSparkles size={17} />
          <div>
            <strong>AI generation unavailable</strong>
            <p>
              Your material is saved. Open the Concepts, Flashcards or Practice tab to generate
              content as soon as AI is available again.
            </p>
          </div>
        </div>
      ) : null}

      <div className="pack-getting-started-recommended">
        <h3>Recommended</h3>
        <div className="pack-getting-started-modes">
          <ButtonLink to={learnHref}>
            <IconZap size={17} /> Start Learn
          </ButtonLink>
          <Link to="?tab=overview#pack-overview" className="btn btn-secondary">
            <IconBook size={17} /> Review material
          </Link>
          <Link to="?tab=concepts" className="btn btn-secondary">
            <IconBook size={17} /> View concepts
          </Link>
          <Link to="?tab=practice" className="btn btn-secondary">
            <IconSparkles size={17} /> Practice
          </Link>
          <Link to="?tab=test" className="btn btn-secondary">
            <IconQuiz size={17} /> Take a test
          </Link>
        </div>
        {pack.counts.flashcards > 0 && pack.legacySetId ? (
          <Link to={`/sets/${pack.legacySetId}/study`} className="muted" style={{ fontSize: '0.85rem' }}>
            <IconCards size={15} /> Or study the flashcards with spaced repetition
          </Link>
        ) : null}
      </div>

      {pack.counts.concepts === 0 && pack.counts.flashcards === 0 && pack.counts.practiceQuestions === 0 ? (
        <Badge variant="warning">
          Your material is saved, but no study content was generated yet.
        </Badge>
      ) : null}
    </section>
  );
}

/** True when a pack has content but the student has not studied it yet. */
export function isFreshPack(pack: StudyPackDetail): boolean {
  const untouched =
    pack.progress.studiedCards === 0 &&
    pack.progress.practiceAnswers === 0 &&
    pack.progress.testAttempts === 0 &&
    pack.progress.dueCards === 0;
  const hasContent = pack.counts.concepts > 0 || pack.counts.flashcards > 0;
  return pack.isOwner && untouched && hasContent;
}
