import { Link } from 'react-router-dom';
import { IconArrowRight, IconFlag } from '../ui/Icons';
import type { ExamBanner as ExamBannerData } from '../../types';

/**
 * "Biology exam in 9 days — Your plan is adjusted for the exam." Calm, factual,
 * no alarm colours: the countdown is real (calendar days in the student's time
 * zone) and the note only appears when the plan really was adjusted.
 */
export function ExamBanner({ exam }: { exam: ExamBannerData }) {
  return (
    <section className="exam-banner" aria-label="Upcoming exam">
      <span className="exam-banner-icon" aria-hidden="true">
        <IconFlag size={20} />
      </span>
      <div className="exam-banner-copy">
        <strong>{exam.message}</strong>
        {exam.note ? <span>{exam.note}</span> : null}
      </div>
      <Link to={`/study-packs/${exam.packId}`} className="exam-banner-link">
        View pack <IconArrowRight size={15} />
      </Link>
    </section>
  );
}
