import { Link } from 'react-router-dom';
import { Badge } from '../ui/Primitives';
import {
  IconBook,
  IconCards,
  IconChart,
  IconClock,
  IconLayers,
  IconQuiz,
  IconSparkles,
  IconZap,
} from '../ui/Icons';
import { MasteryMeter, formatActivity } from './PackBits';
import { examCountdownLabel, formatExamDate, recommendedHref } from '../../lib/studyPackRoutes';
import type { StudyPackDetail } from '../../types';

/**
 * The Study Pack hero: what this pack is, where the student stands, and the one
 * clear action to take next. Deliberately calm — no gradients, no gamification.
 */
export function PackHero({ pack, tab }: { pack: StudyPackDetail; tab: string }) {
  const action = pack.recommended;
  const continueHref = recommendedHref(pack, action);
  const weakCount = pack.progress.weakConcepts.length;

  const modes = [
    { id: 'learn', label: 'Learn', Icon: IconBook, href: '?tab=learn' },
    {
      id: 'flashcards',
      label: 'Flashcards',
      Icon: IconCards,
      href: pack.legacySetId ? `/sets/${pack.legacySetId}/study` : '?tab=flashcards',
    },
    { id: 'practice', label: 'Practice', Icon: IconZap, href: '?tab=practice' },
    { id: 'test', label: 'Test', Icon: IconQuiz, href: '?tab=test' },
    {
      id: 'review',
      label: 'Review',
      Icon: IconClock,
      href: pack.legacySetId ? `/sets/${pack.legacySetId}/study` : '?tab=flashcards',
    },
    { id: 'tutor', label: 'AI Tutor', Icon: IconSparkles, href: '?tab=tutor' },
  ];

  return (
    <header className="pack-hero">
      <div className="pack-hero-main">
        <div className="pack-hero-copy">
          <span className="eyebrow-label">
            {pack.subjectName ?? 'Study pack'}
            {pack.level ? ` · ${pack.level}` : ''}
          </span>
          <h1>{pack.title}</h1>
          {pack.description ? <p className="pack-hero-description">{pack.description}</p> : null}

          <div className="pack-hero-badges">
            <Badge variant="accent">
              <IconCards size={14} /> {pack.counts.flashcards} flashcards
            </Badge>
            <Badge>
              <IconBook size={14} /> {pack.counts.concepts} concepts
            </Badge>
            <Badge>
              <IconQuiz size={14} /> {pack.counts.practiceQuestions} questions
            </Badge>
            <Badge>
              <IconLayers size={14} /> {pack.counts.sources} source
              {pack.counts.sources === 1 ? '' : 's'}
            </Badge>
            {pack.visibility === 'public' ? <Badge>Public</Badge> : null}
            {pack.examDate ? (
              <Badge variant={pack.examDaysLeft !== null && pack.examDaysLeft <= 7 ? 'warning' : 'default'}>
                Exam {formatExamDate(pack.examDate)} · {examCountdownLabel(pack.examDaysLeft)}
              </Badge>
            ) : null}
            {pack.progress.dueCards > 0 ? <Badge variant="accent">{pack.progress.dueCards} due</Badge> : null}
          </div>

          <div className="pack-hero-actions">
            <Link to={continueHref} className="btn btn-primary">
              <IconZap size={17} /> Continue studying
            </Link>
            <Link to="?tab=overview" className="btn btn-secondary">
              <IconChart size={17} /> Overview
            </Link>
            <span className="pack-hero-activity muted">{formatActivity(pack.progress.lastActivityAt)}</span>
          </div>
        </div>

        <div className="pack-hero-side">
          <div className="pack-mastery-card">
            <span className="pack-label">Mastery</span>
            <div className="pack-mastery-value">{pack.progress.masteryPercent}%</div>
            <MasteryMeter percent={pack.progress.masteryPercent} />
            <dl className="pack-mastery-facts">
              <div>
                <dt>Studied</dt>
                <dd>
                  {pack.progress.studiedCards}/{pack.progress.totalCards} cards
                </dd>
              </div>
              <div>
                <dt>Weak concepts</dt>
                <dd>{weakCount}</dd>
              </div>
              <div>
                <dt>Practice accuracy</dt>
                <dd>
                  {pack.progress.practiceAccuracy === null
                    ? '—'
                    : `${Math.round(pack.progress.practiceAccuracy * 100)}%`}
                </dd>
              </div>
              <div>
                <dt>Best test</dt>
                <dd>
                  {pack.progress.bestTestScorePercent === null
                    ? '—'
                    : `${pack.progress.bestTestScorePercent}%`}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <nav className="pack-modes" aria-label="Study modes">
        {modes.map(({ id, label, Icon, href }) => {
          const isCurrent = tab === id;
          return (
            <Link
              key={id}
              to={href}
              className={`pack-mode${isCurrent ? ' active' : ''}`}
              aria-current={isCurrent ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
