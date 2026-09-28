import { Link } from 'react-router-dom';
import { Badge } from './Primitives';
import { IconArrowRight, IconBook, IconLayers } from './Icons';
import type { StudySetSummary } from '../../types';

/** Shared library tile. Only displays metadata actually returned by the API. */
export function StudySetCard({ set }: { set: StudySetSummary }) {
  const tone = [...(set.subjectName ?? set.title)].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
  return (
    <Link to={`/sets/${set.id}`} className={`card card-interactive set-card set-tone-${tone}`}>
      <div className="set-card-top">
        <span className="set-card-symbol">
          <IconBook size={22} />
        </span>
        <Badge>{set.level || (set.visibility === 'public' ? 'Public set' : 'Private set')}</Badge>
      </div>
      <div className="set-card-body">
        <span className="set-card-subject">{set.subjectName ?? 'Independent study'}</span>
        <h3 className="set-card-title">{set.title}</h3>
        <p className="set-card-desc">{set.description || 'A little practice makes it stick.'}</p>
      </div>
      <div className="set-card-footer">
        <span className="set-card-meta">
          <IconLayers size={15} /> {set.cardCount} cards
        </span>
        <span className="set-card-author">{set.authorName}</span>
        <IconArrowRight size={16} />
      </div>
    </Link>
  );
}
