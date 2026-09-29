import { Link } from 'react-router-dom';
import { Badge } from '../ui/Primitives';
import { MasteryMeter } from '../study-pack/PackBits';
import { examInLabel, relativeDay } from '../../lib/sessionCopy';
import type { PackProgressRow } from '../../types';
import { TrendSparkline, trendSummary } from './TrendSparkline';

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** One study pack: mastery, its real trend, weak and strong concepts and recent activity. */
export function PackProgressCard({ pack }: { pack: PackProgressRow }) {
  const active = relativeDay(pack.lastActivityAt);
  const exam = examInLabel(pack.examDaysLeft);
  return (
    <li className="card progress-pack">
      <div className="progress-pack-head">
        <div>
          <h3>
            <Link to={`/study-packs/${pack.packId}`}>{pack.title}</Link>
          </h3>
          {pack.subjectName ? <span className="muted">{pack.subjectName}</span> : null}
        </div>
        <div className="progress-pack-badges">
          {exam ? <Badge variant={pack.examDaysLeft !== null && pack.examDaysLeft <= 7 ? 'warning' : 'default'}>{exam}</Badge> : null}
          {pack.dueCards > 0 ? <Badge variant="accent">{pack.dueCards} due</Badge> : null}
        </div>
      </div>

      <div className="progress-pack-mastery">
        <MasteryMeter percent={pack.masteryPercent} label="Mastery" />
        <div className="progress-pack-trend">
          <TrendSparkline trend={pack.trend} />
          <p className="muted">{trendSummary(pack.trend)}</p>
        </div>
      </div>

      <div className="progress-pack-concepts">
        <div>
          <span className="session-subheading">Needs practice</span>
          {pack.weakConcepts.length > 0 ? (
            <ul className="session-concept-chips" role="list">
              {pack.weakConcepts.map((concept) => (
                <li key={concept.id}>
                  <Link
                    className="session-concept-chip"
                    to={`/study-packs/${pack.packId}?tab=practice&concept=${concept.id}`}
                    aria-label={`Practice ${concept.name} (${concept.masteryPercent}%)`}
                  >
                    <span>{concept.name}</span>
                    <span className="session-concept-mastery">{concept.masteryPercent}%</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No weak concepts.</p>
          )}
        </div>
        <div>
          <span className="session-subheading">You know well</span>
          {pack.strongConcepts.length > 0 ? (
            <ul className="session-concept-chips" role="list">
              {pack.strongConcepts.map((concept) => (
                <li key={concept.id} className="session-concept-chip is-static">
                  <span>{concept.name}</span>
                  <span className="session-concept-mastery">{concept.masteryPercent}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing above 85% yet.</p>
          )}
        </div>
      </div>

      <dl className="progress-pack-facts">
        <Fact label="Sessions" value={pack.sessionsCompleted} />
        <Fact label="Questions answered" value={pack.questionsAnswered} />
        <Fact label="Active days (7d)" value={`${pack.activeDaysLast7} of 7`} />
        <Fact label="Last activity" value={active ?? 'Not studied yet'} />
      </dl>
    </li>
  );
}
