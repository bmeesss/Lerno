import { StudySetCard } from '../components/ui/StudySetCard';
import { Button, ButtonLink } from '../components/ui/Button';
import { EmptyState, LoadingRow } from '../components/ui/Primitives';
import { IconHeart } from '../components/ui/Icons';
import { useAsync } from '../hooks/useAsync';
import { favoriteService } from '../services/favoriteService';
import type { StudySetSummary } from '../types';

export function FavoritesPage() {
  const { data, loading, error, reload } = useAsync<StudySetSummary[]>(
    () => favoriteService.list(),
    [],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Favorites</h1>
          <p>Public sets you saved for later.</p>
        </div>
        <ButtonLink to="/discover" variant="secondary">
          Find more sets
        </ButtonLink>
      </div>

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState
          title="Could not load favorites"
          description={error}
          action={
            <Button variant="secondary" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : data && data.length > 0 ? (
        <div className="set-grid">
          {data.map((set) => (
            <StudySetCard key={set.id} set={set} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<IconHeart size={22} />}
          title="Nothing saved yet"
          description="Found something worth coming back to? Save a set and keep it close."
          action={<ButtonLink to="/discover">Discover public sets</ButtonLink>}
        />
      )}
    </>
  );
}
