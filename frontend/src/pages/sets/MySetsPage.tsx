import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { IconLayers, IconPlus, IconSparkles } from '../../components/ui/Icons';
import { AiGenerateSetModal } from '../../components/ai/AiGenerateSetModal';
import { useAsync } from '../../hooks/useAsync';
import { studySetService } from '../../services/studySetService';
import type { StudySetSummary } from '../../types';

export function MySetsPage() {
  const { data, loading, error, reload } = useAsync<StudySetSummary[]>(
    () => studySetService.listMine(),
    [],
  );
  const [generateOpen, setGenerateOpen] = useState(false);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>My sets</h1>
          <p>Study sets you created — private or shared publicly.</p>
        </div>
        <div className="page-header-actions">
          <Button variant="secondary" onClick={() => setGenerateOpen(true)}>
            <IconSparkles size={16} /> Genereer met AI
          </Button>
          <ButtonLink to="/sets/new">
            <IconPlus size={17} /> New set
          </ButtonLink>
        </div>
      </div>

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState title="Could not load your sets" description={error} />
      ) : data && data.length > 0 ? (
        <div className="set-grid">
          {data.map((set) => (
            <Link key={set.id} to={`/sets/${set.id}`} className="card card-interactive set-card">
              <div className="set-card-top">
                <div className="set-card-title">{set.title}</div>
                {set.visibility === 'public' ? (
                  <Badge variant="accent">Public</Badge>
                ) : (
                  <Badge>Private</Badge>
                )}
              </div>
              <div className="set-card-desc">{set.description || 'No description'}</div>
              <div className="set-card-footer">
                <span className="set-card-meta">
                  <span>{set.subjectName ?? 'No subject'}</span>
                  {set.level ? <span> · {set.level}</span> : null}
                </span>
                <span>{set.cardCount} cards</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<IconLayers size={22} />}
          title="No study sets yet"
          description="Create your first set manually, by pasting a list, or by importing a CSV."
          action={<ButtonLink to="/sets/new">Create your first set</ButtonLink>}
        />
      )}

      <AiGenerateSetModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onSaved={() => {
          setGenerateOpen(false);
          reload();
        }}
      />
    </>
  );
}
