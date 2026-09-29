import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ProgressBar } from '../ui/Primitives';
import { IconArrowRight, IconClock, IconSparkles, IconZap } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { recommendedHref } from '../../lib/studyPackRoutes';
import { studyPackService } from '../../services/studyPackService';
import { MarkdownLite } from '../ai/MarkdownLite';
import { MasteryMeter, PackStat, masteryLabel } from './PackBits';
import { PreviewEditor } from './PreviewEditor';
import type { PackPreview, StudyPackDetail } from '../../types';

/**
 * Overview: "here is what matters, here is what you should do next".
 * Summary, key concepts, progress, weak topics and the study plan.
 */
export function PackOverview({ pack, onChanged }: { pack: StudyPackDetail; onChanged: () => void }) {
  const toast = useToast();
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const weak = pack.progress.weakConcepts;
  const concepts = [...pack.concepts].sort((a, b) => a.masteryPercent - b.masteryPercent);
  const action = pack.recommended;

  async function generateSummary() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await studyPackService.generate(pack.id, 'summary');
      if (result.target === 'summary') setPreview(result);
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not generate a summary', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function generatePlan() {
    if (busy) return;
    setBusy(true);
    try {
      await studyPackService.createPlan(pack.id, { minutesPerDay: 30 });
      toast.show('Study plan ready', 'success');
      onChanged();
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not build a study plan', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pack-overview">
      <section className="card pack-next" aria-labelledby="pack-next-heading">
        <div className="pack-next-copy">
          <span className="eyebrow-label">Recommended next</span>
          <h2 id="pack-next-heading">{action.label}</h2>
          <p>{action.description}</p>
          {weak.length > 0 ? (
            <p className="muted">
              You&apos;re weakest on {weak.length} concept{weak.length === 1 ? '' : 's'}:{' '}
              {weak
                .slice(0, 3)
                .map((concept) => concept.name)
                .join(', ')}
              {weak.length > 3 ? '…' : ''}
            </p>
          ) : null}
          <div className="pack-next-actions">
            <ButtonLink to={recommendedHref(pack, action)}>
              <IconZap size={17} /> Start now
            </ButtonLink>
            <ButtonLink to="?tab=progress" variant="secondary">
              View progress
            </ButtonLink>
          </div>
        </div>
        {pack.examDate ? (
          <div className="pack-exam-card">
            <span className="eyebrow-label">Exam</span>
            <strong>
              {pack.examDaysLeft !== null && pack.examDaysLeft >= 0
                ? `${pack.examDaysLeft} day${pack.examDaysLeft === 1 ? '' : 's'} left`
                : 'Exam date passed'}
            </strong>
            <p className="muted">{pack.examDate}</p>
            {pack.studyPlan ? (
              <Link to="?tab=progress" className="pack-exam-plan-link">
                Study plan ready <IconArrowRight size={14} />
              </Link>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void generatePlan()} disabled={busy}>
                Build study plan
              </Button>
            )}
          </div>
        ) : null}
      </section>

      <div className="pack-overview-grid">
        <section className="card" aria-labelledby="pack-summary-heading">
          <div className="section-title">
            <div>
              <h2 id="pack-summary-heading">Summary</h2>
              <p className="muted">
                {pack.summary
                  ? 'Generated from your own material — edit or regenerate it any time.'
                  : 'Turn your material into a short, readable overview.'}
              </p>
            </div>
            {pack.summary ? (
              <Button variant="secondary" size="sm" onClick={() => void generateSummary()} disabled={busy}>
                <IconSparkles size={16} /> Regenerate
              </Button>
            ) : null}
          </div>

          {preview && preview.target === 'summary' ? (
            <PreviewEditor
              packId={pack.id}
              preview={preview}
              onDiscard={() => setPreview(null)}
              onApplied={(message) => {
                setPreview(null);
                toast.show(message, 'success');
                onChanged();
              }}
            />
          ) : pack.summary ? (
            <div className="pack-summary-body">
              <MarkdownLite text={pack.summary} />
            </div>
          ) : (
            <EmptyState
              icon={<IconSparkles />}
              title="No summary yet"
              description="Lerno can summarise the sources in this pack so you know what matters."
              action={
                <Button onClick={() => void generateSummary()} disabled={busy || pack.counts.readySources === 0}>
                  {busy ? 'Generating…' : 'Generate summary'}
                </Button>
              }
            />
          )}
        </section>

        <section className="card" aria-labelledby="pack-concepts-heading">
          <div className="section-title">
            <div>
              <h2 id="pack-concepts-heading">Key concepts</h2>
              <p className="muted">What you should be able to explain.</p>
            </div>
            <Link to="?tab=concepts">
              All {pack.counts.concepts} <IconArrowRight size={14} />
            </Link>
          </div>

          {concepts.length > 0 ? (
            <ul className="pack-concept-list">
              {concepts.slice(0, 5).map((concept) => (
                <li key={concept.id} className="pack-concept-row">
                  <div className="pack-concept-copy">
                    <strong>{concept.name}</strong>
                    <span className="muted">
                      {concept.cardCount} cards · {concept.questionCount} questions
                    </span>
                  </div>
                  <div className="pack-concept-mastery">
                    <MasteryMeter percent={concept.masteryPercent} compact />
                    <span className="muted">{masteryLabel(concept.masteryPercent)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No concepts yet"
              description="Extract the key concepts from your sources to start structured learning."
              action={<ButtonLink to="?tab=concepts">Extract concepts</ButtonLink>}
            />
          )}
        </section>

        <section className="card" aria-labelledby="pack-progress-heading">
          <div className="section-title">
            <div>
              <h2 id="pack-progress-heading">Study progress</h2>
              <p className="muted">Where this pack stands right now.</p>
            </div>
          </div>

          <div className="pack-stat-grid">
            <PackStat label="Flashcards" value={pack.counts.flashcards} sub={`${pack.progress.studiedCards} studied`} />
            <PackStat label="Due now" value={pack.progress.dueCards} sub="spaced repetition" />
            <PackStat label="Practice questions" value={pack.counts.practiceQuestions} />
            <PackStat
              label="Practice accuracy"
              value={
                pack.progress.practiceAccuracy === null
                  ? '—'
                  : `${Math.round(pack.progress.practiceAccuracy * 100)}%`
              }
              sub={`${pack.progress.practiceAnswers} answers`}
            />
          </div>

          <div className="pack-progress-block">
            <span className="pack-label">Mastery</span>
            <ProgressBar value={pack.progress.masteryPercent} />
            <p className="muted" style={{ marginTop: 8 }}>
              {pack.progress.masteryPercent}% mastered across {pack.counts.concepts} concepts
              {pack.counts.concepts === 0 ? ' — add concepts to start tracking mastery' : ''}
            </p>
          </div>

          {weak.length > 0 ? (
            <div className="pack-weak-block">
              <span className="pack-label">Weak topics</span>
              <div className="pack-chip-row">
                {weak.slice(0, 6).map((concept) => (
                  <Link
                    key={concept.id}
                    to={`?tab=practice&concept=${concept.id}`}
                    className="chip chip-active"
                  >
                    {concept.name}
                  </Link>
                ))}
              </div>
              <p className="muted">Practice these first — they come back in Review automatically.</p>
            </div>
          ) : (
            <p className="muted pack-weak-block">
              No weak topics detected yet. Practice or take a test and Lerno will find them.
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="pack-plan-heading">
          <div className="section-title">
            <div>
              <h2 id="pack-plan-heading">Study plan</h2>
              <p className="muted">
                {pack.examDate
                  ? 'Built around your exam date and what is still weak.'
                  : 'Add an exam date for a plan that counts down to it.'}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void generatePlan()} disabled={busy}>
              <IconClock size={16} /> {pack.studyPlan ? 'Rebuild' : 'Build plan'}
            </Button>
          </div>

          {pack.studyPlan ? (
            <>
              <p>{pack.studyPlan.overview}</p>
              <ol className="pack-plan-list">
                {pack.studyPlan.sessions.slice(0, 5).map((session) => (
                  <li key={session.day}>
                    <span className="pack-plan-day">Day {session.day}</span>
                    <div>
                      <strong>{session.focus}</strong>
                      <span className="muted">
                        {session.minutes} min{session.date ? ` · ${session.date}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              {pack.studyPlan.sessions.length > 5 ? (
                <Link to="?tab=progress">
                  Full plan ({pack.studyPlan.sessions.length} days) <IconArrowRight size={14} />
                </Link>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="No study plan yet"
              description="Lerno spreads learning, practice and review over the days you have left."
              action={
                <Button onClick={() => void generatePlan()} disabled={busy}>
                  {busy ? 'Building…' : 'Build study plan'}
                </Button>
              }
            />
          )}
        </section>
      </div>

      {pack.schoolMethod?.method ? (
        <p className="muted pack-method-note">
          <Badge>{pack.schoolMethod.method}</Badge>{' '}
          {pack.schoolMethod.publisher ? `${pack.schoolMethod.publisher} · ` : ''}
          {pack.schoolMethod.edition ?? ''} {pack.schoolMethod.chapter ?? ''}
        </p>
      ) : null}
    </div>
  );
}
