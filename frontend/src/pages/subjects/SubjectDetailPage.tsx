import { Link, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { IconArrowRight, IconFlag, IconSparkles } from '../../components/ui/Icons';
import { MasteryMeter } from '../../components/study-pack/PackBits';
import { useAsync } from '../../hooks/useAsync';
import { examInLabel, relativeDay } from '../../lib/sessionCopy';
import {
  formatExamDate,
  sessionHref,
  taskActionLabel,
  todayTaskHref,
} from '../../lib/studyPackRoutes';
import { stepReason } from '../../lib/todayPlan';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type { StudySetSummary, SubjectOverview } from '../../types';

interface SubjectData {
  overview: SubjectOverview;
  sets: StudySetSummary[];
}

const ACTIVITY_NOUN = {
  learn: 'Learn',
  practice: 'Practice',
  review: 'Review',
  test: 'Test',
} as const;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * One subject, seen as a student: how well they know it, what is due, which
 * concepts are weak, when the exams are, what they did recently — and one clear
 * way to continue. All numbers come from the subject overview (a single request).
 */
export function SubjectDetailPage() {
  const { subjectId = '' } = useParams<{ subjectId: string }>();
  const { data, loading, error, reload } = useAsync<SubjectData>(async () => {
    const [overview, sets] = await Promise.all([
      subjectService.overview(subjectId),
      // Sets are the older material type: a failing list never hides the overview.
      studySetService.listMine().catch(() => [] as StudySetSummary[]),
    ]);
    return { overview, sets };
  }, [subjectId]);

  if (loading && !data) return <LoadingRow large />;

  if (error || !data) {
    const missing = error !== null && /not found/i.test(error);
    return (
      <EmptyState
        title={missing ? 'Subject not found' : 'Could not load this subject'}
        description={
          missing
            ? 'It may have been deleted, or it belongs to someone else.'
            : (error ?? 'Try again in a moment.')
        }
        action={
          <div className="session-empty-actions">
            {missing ? null : <Button onClick={reload}>Try again</Button>}
            <ButtonLink to="/study" variant={missing ? 'primary' : 'secondary'}>
              Back to My Study
            </ButtonLink>
          </div>
        }
      />
    );
  }

  const { overview } = data;
  const { subject, totals, packs, exams, recentActivity, next } = overview;
  const subjectSets = data.sets.filter((set) => set.subjectId === subject.id);
  const nearestExam = exams.find((exam) => exam.daysLeft !== null && exam.daysLeft >= 0) ?? null;
  const weakAcross = packs
    .flatMap((pack) => pack.weakConcepts.map((concept) => ({ ...concept, packId: pack.packId })))
    .sort((a, b) => a.masteryPercent - b.masteryPercent || a.name.localeCompare(b.name))
    .slice(0, 6);
  const nothingYet = packs.length === 0 && subjectSets.length === 0;

  return (
    <div className="stack subject-page" style={{ gap: 24 }}>
      <div className="page-header">
        <div>
          <span className="eyebrow-label">Subject</span>
          <h1>{subject.name}</h1>
          <p>
            {totals.packs} study pack{totals.packs === 1 ? '' : 's'} · {totals.concepts} concept
            {totals.concepts === 1 ? '' : 's'}
            {subjectSets.length > 0
              ? ` · ${subjectSets.length} set${subjectSets.length === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <ButtonLink to={`/sets/new?subjectId=${subject.id}`} variant="secondary">
          Create set in {subject.name}
        </ButtonLink>
      </div>

      {nearestExam ? (
        <section className="exam-banner" aria-label="Upcoming exam">
          <span className="exam-banner-icon" aria-hidden="true">
            <IconFlag size={20} />
          </span>
          <div className="exam-banner-copy">
            <strong>
              {nearestExam.title} — {examInLabel(nearestExam.daysLeft)}
            </strong>
            {nearestExam.examDate ? <span>{formatExamDate(nearestExam.examDate)}</span> : null}
          </div>
          <Link to={`/study-packs/${nearestExam.packId}`} className="exam-banner-link">
            View pack <IconArrowRight size={15} />
          </Link>
        </section>
      ) : null}

      {nothingYet ? (
        <EmptyState
          icon={<IconSparkles />}
          title="Nothing in this subject yet"
          description="Add study material and Lerno builds concepts, practice and a plan for this subject."
          action={
            <div className="session-empty-actions">
              <ButtonLink to="/study-packs/new">
                <IconSparkles size={17} /> Add study material
              </ButtonLink>
              <ButtonLink to={`/sets/new?subjectId=${subject.id}`} variant="secondary">
                Create a set manually
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <section className="card subject-summary" aria-labelledby="subject-summary-title">
          <div className="subject-summary-head">
            <div>
              <h2 id="subject-summary-title">Where you stand</h2>
              {next ? (
                <p className="muted">
                  <strong>{next.label}.</strong> {stepReason(next)}
                </p>
              ) : (
                <p className="muted">Nothing needs your attention right now.</p>
              )}
            </div>
            {next ? (
              <ButtonLink to={todayTaskHref(next)} size="lg">
                Continue studying <IconArrowRight size={18} />
              </ButtonLink>
            ) : null}
          </div>
          <dl className="subject-facts">
            <Fact
              label="Mastery"
              value={totals.masteryPercent === null ? 'Not started' : `${totals.masteryPercent}%`}
            />
            <Fact
              label="Due"
              value={`${totals.dueCards} card${totals.dueCards === 1 ? '' : 's'}`}
            />
            <Fact label="Weak concepts" value={String(totals.weakConcepts)} />
            <Fact label="Exams" value={exams.length > 0 ? String(exams.length) : 'None set'} />
          </dl>
        </section>
      )}

      {packs.length > 0 ? (
        <section aria-labelledby="subject-packs-title">
          <div className="section-title">
            <div>
              <h2 id="subject-packs-title">Study packs</h2>
              <p className="muted">Mastery, what is due and where to continue.</p>
            </div>
          </div>
          <ul className="subject-pack-list" role="list">
            {packs.map((pack) => {
              const studied = relativeDay(pack.lastStudiedAt);
              const exam = examInLabel(pack.examDaysLeft);
              return (
                <li key={pack.packId} className="card subject-pack">
                  <div className="subject-pack-head">
                    <h3>
                      <Link to={`/study-packs/${pack.packId}`}>{pack.title}</Link>
                    </h3>
                    <div className="subject-pack-badges">
                      {pack.dueCards > 0 ? (
                        <Badge variant="accent">{pack.dueCards} due</Badge>
                      ) : null}
                      {exam ? (
                        <Badge
                          variant={
                            pack.examDaysLeft !== null && pack.examDaysLeft <= 7
                              ? 'warning'
                              : 'default'
                          }
                        >
                          {exam}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <MasteryMeter percent={pack.masteryPercent} compact />
                  <p className="muted subject-pack-meta">
                    {pack.concepts} concept{pack.concepts === 1 ? '' : 's'} ·{' '}
                    {studied ? `Last studied ${studied}` : 'Not studied yet'}
                  </p>
                  {pack.weakConcepts.length > 0 ? (
                    <div className="subject-pack-weak">
                      <span className="session-subheading">Weak concepts</span>
                      <ul className="session-concept-chips" role="list">
                        {pack.weakConcepts.slice(0, 4).map((concept) => (
                          <li key={concept.id}>
                            <Link
                              className="session-concept-chip"
                              to={`/study-packs/${pack.packId}?tab=practice&concept=${concept.id}`}
                              aria-label={`Practice ${concept.name} (${concept.masteryPercent}%)`}
                            >
                              <span>{concept.name}</span>
                              <span className="session-concept-mastery">
                                {concept.masteryPercent}%
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="subject-pack-actions">
                    {pack.resume ? (
                      <Link
                        className="btn btn-secondary btn-sm"
                        to={sessionHref(pack.resume.sessionId)}
                        aria-label={`Continue ${pack.resume.label}, ${pack.resume.positionLabel}`}
                      >
                        Continue · {pack.resume.positionLabel}
                      </Link>
                    ) : pack.next ? (
                      <Link
                        className="btn btn-secondary btn-sm"
                        to={todayTaskHref(pack.next)}
                        aria-label={`${taskActionLabel(pack.next)}: ${pack.title}`}
                      >
                        {taskActionLabel(pack.next)}
                      </Link>
                    ) : null}
                    <Link className="btn btn-ghost btn-sm" to={`/study-packs/${pack.packId}`}>
                      Open pack
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {weakAcross.length > 0 ? (
        <section aria-labelledby="subject-weak-title">
          <div className="section-title">
            <div>
              <h2 id="subject-weak-title">Needs attention</h2>
              <p className="muted">
                The weakest concepts across this subject. Tap one to practice it.
              </p>
            </div>
          </div>
          <ul className="session-concept-chips" role="list">
            {weakAcross.map((concept) => (
              <li key={`${concept.packId}-${concept.id}`}>
                <Link
                  className="session-concept-chip"
                  to={`/study-packs/${concept.packId}?tab=practice&concept=${concept.id}`}
                >
                  <span>{concept.name}</span>
                  <span className="session-concept-mastery">{concept.masteryPercent}%</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {exams.length > 0 ? (
        <section aria-labelledby="subject-exams-title">
          <div className="section-title">
            <div>
              <h2 id="subject-exams-title">Exams</h2>
            </div>
          </div>
          <ul className="subject-exam-list" role="list">
            {exams.map((exam) => (
              <li key={exam.packId} className="card subject-exam">
                <Link to={`/study-packs/${exam.packId}`}>{exam.title}</Link>
                <span className="muted">
                  {exam.examDate ? formatExamDate(exam.examDate) : ''}
                  {exam.daysLeft !== null ? ` · ${examInLabel(exam.daysLeft) ?? 'Past'}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="subject-activity-title">
        <div className="section-title">
          <div>
            <h2 id="subject-activity-title">Recent activity</h2>
          </div>
        </div>
        {recentActivity.length > 0 ? (
          <ul className="subject-activity-list" role="list">
            {recentActivity.map((entry) => (
              <li key={entry.sessionId} className="card subject-activity">
                <div>
                  <Link to={sessionHref(entry.sessionId)}>{entry.label}</Link>
                  <span className="muted">
                    {' '}
                    · {ACTIVITY_NOUN[entry.type]} · {entry.answered} answered
                    {entry.completedAt ? ` · ${relativeDay(entry.completedAt)}` : ''}
                  </span>
                </div>
                {entry.percent !== null ? <Badge>{entry.percent}%</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No finished sessions yet. Your first practice or test shows up here.
          </p>
        )}
      </section>

      {subjectSets.length > 0 ? (
        <section aria-labelledby="subject-sets-title">
          <div className="section-title">
            <div>
              <h2 id="subject-sets-title">Study sets</h2>
              <p className="muted">Flashcard sets in this subject.</p>
            </div>
          </div>
          <div className="set-grid">
            {subjectSets.map((set) => (
              <Link key={set.id} to={`/sets/${set.id}`} className="card card-interactive">
                <div className="set-card-title">{set.title}</div>
                <div className="set-card-desc">{set.description || 'No description'}</div>
                <div className="set-card-footer">
                  <span>{set.level || 'All levels'}</span>
                  <span>{set.cardCount} cards</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
