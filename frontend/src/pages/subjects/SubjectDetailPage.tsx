import { Link, useParams } from 'react-router-dom';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState, LoadingRow, ProgressBar } from '../../components/ui/Primitives';
import { useAsync } from '../../hooks/useAsync';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type { StudySetSummary, Subject } from '../../types';

export function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const { data: subjects, loading } = useAsync<Subject[]>(() => subjectService.list(), []);
  const { data: sets, loading: setsLoading } = useAsync<StudySetSummary[]>(
    () => studySetService.listMine(),
    [],
  );

  const subject = subjects?.find((item) => item.id === subjectId);
  const subjectSets = (sets ?? []).filter((set) => set.subjectId === subjectId);

  if (loading || setsLoading) return <LoadingRow large />;
  if (!subject) {
    return <EmptyState title="Subject not found" description="It may have been deleted." />;
  }

  const totalCards = subjectSets.reduce((sum, set) => sum + set.cardCount, 0);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{subject.name}</h1>
          <p>
            {subjectSets.length} set{subjectSets.length === 1 ? '' : 's'} · {totalCards} cards
          </p>
        </div>
        <ButtonLink to={`/sets/new?subjectId=${subject.id}`}>
          Create set in {subject.name}
        </ButtonLink>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="stat-label">Progress summary</div>
        <p style={{ margin: '8px 0 12px' }}>
          Study sets in this subject and how much material they cover. Per-card progress shows on
          the Progress page.
        </p>
        <ProgressBar value={subjectSets.length} max={Math.max(subjectSets.length, 1)} />
        <div className="muted" style={{ fontSize: '0.825rem', marginTop: 8 }}>
          {subjectSets.length} of {subjectSets.length} sets created · {totalCards} cards total
        </div>
      </div>

      {subjectSets.length > 0 ? (
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
      ) : (
        <EmptyState
          title="No sets in this subject yet"
          description="Create a study set to start filling this subject."
          action={
            <ButtonLink to={`/sets/new?subjectId=${subject.id}`}>Create study set</ButtonLink>
          }
        />
      )}
    </>
  );
}
