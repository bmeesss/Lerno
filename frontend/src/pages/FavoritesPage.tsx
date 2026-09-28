import { Link } from 'react-router-dom';
import { ButtonLink } from '../components/ui/Button';
import { EmptyState, LoadingRow } from '../components/ui/Primitives';
import { IconHeart } from '../components/ui/Icons';
import { useAsync } from '../hooks/useAsync';
import { favoriteService } from '../services/favoriteService';
import type { StudySetSummary } from '../types';

export function FavoritesPage() {
  const { data, loading, error } = useAsync<StudySetSummary[]>(() => favoriteService.list(), []);

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
        <EmptyState title="Could not load favorites" description={error} />
      ) : data && data.length > 0 ? (
        <div className="set-grid">
          {data.map((set) => (
            <Link key={set.id} to={`/sets/${set.id}`} className="card card-interactive set-card">
              <div className="set-card-title">{set.title}</div>
              <div className="set-card-desc">{set.description || 'No description'}</div>
              <div className="set-card-footer">
                <span className="set-card-meta">
                  <span>{set.authorName}</span>
                </span>
                <span>{set.cardCount} cards</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<IconHeart size={22} />}
          title="No favorites yet"
          description="Save public study sets to find them here — it works without clutter."
          action={<ButtonLink to="/discover">Discover public sets</ButtonLink>}
        />
      )}
    </>
  );
}
