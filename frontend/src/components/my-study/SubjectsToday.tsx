import { Link } from 'react-router-dom';
import { examInLabel } from '../../lib/sessionCopy';
import { taskActionLabel, todayTaskHref } from '../../lib/studyPackRoutes';
import { stepMeta, stepTitle } from '../../lib/todayPlan';
import type { SubjectToday } from '../../types';

function facts(subject: SubjectToday): string {
  const parts: string[] = [];
  if (subject.masteryPercent !== null) parts.push(`${subject.masteryPercent}% mastery`);
  if (subject.weakConcepts > 0) parts.push(`${subject.weakConcepts} weak`);
  if (subject.dueCards > 0) parts.push(`${subject.dueCards} due`);
  const exam = examInLabel(subject.examDaysLeft);
  if (exam) parts.push(exam);
  return parts.join(' · ');
}

/**
 * What to do in each subject today. The order and the action per subject come
 * from the recommendation engine (mastery, due work, exam dates): no subject is
 * ever placed first because of its name. Shown when the student studies more
 * than one subject — with one, the plan above already says it all.
 */
export function SubjectsToday({ subjects }: { subjects: SubjectToday[] }) {
  if (subjects.length < 2) return null;

  return (
    <section aria-labelledby="my-study-subjects">
      <div className="section-title">
        <div>
          <h2 id="my-study-subjects">By subject</h2>
          <p className="muted">
            What matters most in each subject today, chosen from your own progress.
          </p>
        </div>
      </div>
      <ul className="subject-today-list" role="list">
        {subjects.map((subject) => {
          const next = subject.next;
          const detail = facts(subject);
          return (
            <li key={subject.subjectId ?? subject.subjectName} className="card subject-today">
              <div className="subject-today-copy">
                <h3>
                  {subject.subjectId ? (
                    <Link to={`/subjects/${subject.subjectId}`}>{subject.subjectName}</Link>
                  ) : (
                    subject.subjectName
                  )}
                </h3>
                {next ? (
                  <>
                    <p className="subject-today-next">{stepTitle(next)}</p>
                    <p className="muted subject-today-meta">
                      {stepMeta(next, { showPack: subject.packs > 1 })}
                    </p>
                  </>
                ) : (
                  <p className="muted">Nothing planned today.</p>
                )}
                {detail ? <p className="muted subject-today-facts">{detail}</p> : null}
              </div>
              {next ? (
                <Link
                  className="btn btn-secondary btn-sm"
                  to={todayTaskHref(next)}
                  aria-label={`${taskActionLabel(next)}: ${subject.subjectName}`}
                >
                  {taskActionLabel(next)}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
