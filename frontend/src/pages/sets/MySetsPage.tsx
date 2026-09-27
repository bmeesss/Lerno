import { Link } from 'react-router-dom';
import { ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { IconPlus } from '../../components/ui/Icons';
import { useAsync } from '../../hooks/useAsync';
import { studySetService } from '../../services/studySetService';
import type { StudySetSummary } from '../../types';

export function MySetsPage() {
  const { data, loading, error } = useAsync<StudySetSummary[]>(
    () => studySetService.listMine(),
    [],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>My sets</h1>
          <p>Study sets you created — private or shared publicly.</p>
        </div>
        <ButtonLink to="/sets/new">
          <IconPlus size={17} /> New set
        </ButtonLink>
      </div>

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState title="Could not load your sets" description={error} />
      ) : data && data.length > 0 ? (
        <div className="set-grid">
          {data.map((set) => (
            <Link key={set.id} to={`/sets/${set.id}`} className="card card-interactive">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div className="set-card-title">{set.title}</div>
                {set.visibility === 'public' ? (
                  <Badge variant="accent">Public</Badge>
                ) : (
                  <Badge>Private</Badge>
                )}
              </div>
              <div className="set-card-desc">{set.description || 'No description'}</div>
              <div className="set-card-footer">
                <span>{set.subjectName ?? 'No subject'}</span>
                <span>{set.cardCount} cards</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No study sets yet"
          description="Create your first set manually, by pasting a list, or by importing a CSV."
          action={<ButtonLink to="/sets/new">Create your first set</ButtonLink>}
        />
      )}
    </>
  );
}
