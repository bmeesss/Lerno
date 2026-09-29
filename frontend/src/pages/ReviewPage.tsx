import { Link } from 'react-router-dom';
import { ButtonLink } from '../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../components/ui/Primitives';
import { IconArrowRight, IconBook, IconLayers, IconLightbulb, IconZap } from '../components/ui/Icons';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../hooks/useAuth';
import { studyPackService } from '../services/studyPackService';
import { todayTaskHref } from '../lib/studyPackRoutes';
import type { PackReviewSummary, StudyPackToday } from '../types';

/**
 * Review — pack-aware.
 *
 * Not a flat card list: it answers "what needs attention", links straight to the
 * pack that needs it, and keeps weak concepts visible next to spaced repetition.
 */
export function ReviewPage() {
  const { user } = useAuth();
  const { data, loading, error } = useAsync<PackReviewSummary | null>(
    () => (user ? studyPackService.reviewQueue() : Promise.resolve(null)),
    [user?.id],
  );
  const { data: today } = useAsync<StudyPackToday | null>(
    () => (user ? studyPackService.today() : Promise.resolve(null)),
    [user?.id],
  );

  if (!user) {
    return (
      <EmptyState
        title="Log in to see your review queue"
        description="Spaced repetition is personal: Lerno schedules reviews on your own account."
        action={<ButtonLink to="/login">Log in</ButtonLink>}
      />
    );
  }

  if (loading) return <LoadingRow large />;

  if (error || !data) {
    return <EmptyState title="Could not load reviews" description={error ?? 'Try again in a moment.'} />;
  }

  const needsReview = data.packsNeedingReview.filter((entry) => entry.dueCount > 0);
  const weakPacks = data.weakConceptPacks;
  const firstDue = needsReview[0] ?? null;
  const firstWeak = weakPacks[0] ?? null;

  const nextAction = today?.recommended
    ? {
        label: today.recommended.label,
        description: today.recommended.description,
        to: todayTaskHref(today.recommended),
      }
    : firstDue
      ? {
          label: `Review ${data.cardsDue} card${data.cardsDue === 1 ? '' : 's'}`,
          description: `Start with ${firstDue.title} — spaced repetition says these are ready.`,
          to: firstDue.packId ? `/study-packs/${firstDue.packId}?tab=flashcards` : '#',
        }
      : firstWeak
        ? {
            label: `Practise your weak concepts`,
            description: `${firstWeak.packTitle} has ${firstWeak.weakConcepts} concept${
              firstWeak.weakConcepts === 1 ? '' : 's'
            } below mastery — practice finds them.`,
            to: `/study-packs/${firstWeak.packId}?tab=practice`,
          }
        : null;

  const hasAnything =
    needsReview.length > 0 ||
    weakPacks.length > 0 ||
    data.conceptsDue > 0 ||
    data.testsToReview > 0 ||
    Boolean(today?.recommended && today.recommended.type !== 'add-material');

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-header">
        <div>
          <span className="eyebrow-label">Review</span>
          <h1>What needs your attention</h1>
          <p>Spaced repetition plus the concepts you keep getting wrong.</p>
        </div>
        {nextAction ? (
          <ButtonLink to={nextAction.to}>
            <IconZap size={17} /> Start reviewing
          </ButtonLink>
        ) : null}
      </div>

      {hasAnything ? (
        <>
          <section className="review-summary" aria-label="Review overview">
            <div className="card review-summary-card">
              <span className="pack-label">Cards due</span>
              <strong className="review-summary-value">{data.cardsDue}</strong>
              <span className="muted">scheduled by spaced repetition</span>
            </div>
            <div className="card review-summary-card">
              <span className="pack-label">Weak concepts</span>
              <strong className="review-summary-value">{data.weakConceptCount}</strong>
              <span className="muted">below mastery in your packs</span>
            </div>
            <div className="card review-summary-card">
              <span className="pack-label">Tests to review</span>
              <strong className="review-summary-value">{data.testsToReview}</strong>
              <span className="muted">with weak concepts to revisit</span>
            </div>
            <div className="card review-summary-card">
              <span className="pack-label">Concepts due</span>
              <strong className="review-summary-value">{data.conceptsDue}</strong>
              <span className="muted">ready for spaced review</span>
            </div>
          </section>

          {nextAction ? (
            <section className="card review-next">
              <div>
                <span className="eyebrow-label">Recommended next</span>
                <h2>{nextAction.label}</h2>
                <p className="muted">{nextAction.description}</p>
              </div>
              <Link to={nextAction.to} className="btn btn-primary">
                Start <IconArrowRight size={17} />
              </Link>
            </section>
          ) : null}

          {needsReview.length > 0 ? (
            <section aria-labelledby="review-cards-heading">
              <div className="section-title">
                <div>
                  <h2 id="review-cards-heading">Cards due</h2>
                  <p className="muted">Grouped by study pack, oldest due first.</p>
                </div>
              </div>
              <div className="stack" style={{ gap: 12 }}>
                {needsReview.map((entry) => (
                  <div key={entry.packId ?? entry.title} className="list-row">
                    <span className="list-row-icon">
                      {entry.packId ? <IconLayers size={19} /> : <IconBook size={19} />}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="list-row-title">{entry.title}</div>
                      <div className="muted" style={{ fontSize: '0.825rem' }}>
                        {entry.nextReviewAt
                          ? `Oldest due ${new Date(entry.nextReviewAt).toLocaleDateString()}`
                          : 'Due now'}
                      </div>
                    </div>
                    <Badge variant="accent">{entry.dueCount} due</Badge>
                    <Link
                      to={entry.packId ? `/study-packs/${entry.packId}?tab=flashcards` : '#'}
                      className="btn btn-primary btn-sm"
                    >
                      Review
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {weakPacks.length > 0 ? (
            <section aria-labelledby="review-weak-heading">
              <div className="section-title">
                <div>
                  <h2 id="review-weak-heading">Weak concepts</h2>
                  <p className="muted">
                    Practice these first — they come back here until mastery improves.
                  </p>
                </div>
              </div>
              <div className="stack" style={{ gap: 12 }}>
                {weakPacks.map((entry) => (
                  <div key={entry.packId} className="list-row">
                    <span className="list-row-icon">
                      <IconLightbulb size={19} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="list-row-title">{entry.packTitle}</div>
                      <div className="muted" style={{ fontSize: '0.825rem' }}>
                        {entry.masteryPercent}% mastery across this pack
                      </div>
                    </div>
                    <Badge variant="warning">
                      {entry.weakConcepts} weak concept{entry.weakConcepts === 1 ? '' : 's'}
                    </Badge>
                    <Link to={`/study-packs/${entry.packId}?tab=practice`} className="btn btn-secondary btn-sm">
                      Practise
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="All caught up"
          description="Nothing is due and no weak concepts are open. Learn something new or take a test to find gaps."
          action={
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <ButtonLink to="/study-packs">Open study packs</ButtonLink>
              <ButtonLink to="/discover" variant="secondary">
                Discover packs
              </ButtonLink>
            </div>
          }
        />
      )}
    </div>
  );
}
