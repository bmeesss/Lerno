import { useState } from 'react';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { StudySetCard } from '../../components/ui/StudySetCard';
import { IconLayers, IconPlus, IconSearch, IconSparkles } from '../../components/ui/Icons';
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
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [subject, setSubject] = useState('');
  const sets = (data ?? []).filter(
    (set) =>
      (visibility === 'all' || set.visibility === visibility) &&
      (!subject || set.subjectName === subject) &&
      `${set.title} ${set.description} ${set.subjectName ?? ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const subjects = [
    ...new Set(
      (data ?? []).map((set) => set.subjectName).filter((name): name is string => Boolean(name)),
    ),
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow-label">Your library</div>
          <h1>My sets</h1>
          <p>Small collections. Big understanding.</p>
        </div>
        <div className="page-header-actions">
          <ButtonLink to="/ai/studio" variant="secondary">
            <IconSparkles size={17} /> Study Studio
          </ButtonLink>
          <Button variant="secondary" onClick={() => setGenerateOpen(true)}>
            <IconSparkles size={17} /> Generate with AI
          </Button>
          <ButtonLink to="/sets/new">
            <IconPlus size={17} /> New set
          </ButtonLink>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="search-field">
          <IconSearch size={18} />
          <input
            className="input"
            type="search"
            aria-label="Search your sets"
            placeholder="Find a set in your library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="select"
          aria-label="Filter by subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        >
          <option value="">All subjects</option>
          {subjects.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="library-tabs">
        <div className="segmented-control" aria-label="Set visibility">
          {['all', 'private', 'public'].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={visibility === value}
              onClick={() => setVisibility(value)}
            >
              {value === 'all' ? 'All sets' : value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        {data && (
          <span className="muted">
            {sets.length} set{sets.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState
          title="Could not load your sets"
          description={error}
          action={<Button onClick={reload}>Try again</Button>}
        />
      ) : sets.length > 0 ? (
        <div className="set-grid">
          {sets.map((set) => (
            <StudySetCard key={set.id} set={set} />
          ))}
        </div>
      ) : data?.length ? (
        <EmptyState
          icon={<IconSearch />}
          title="No matching sets"
          description="Try a different keyword or clear your filters."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setSubject('');
                setVisibility('all');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<IconLayers size={24} />}
          title="No study sets yet"
          description="Turn your notes into your next little breakthrough."
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
