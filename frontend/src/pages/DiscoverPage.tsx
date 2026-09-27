import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../components/ui/Primitives';
import { IconSearch } from '../components/ui/Icons';
import { ApiError } from '../lib/api';
import { discoverService, type DiscoverFacets } from '../services/discoverService';
import type { Paginated, StudySetSummary } from '../types';

const PAGE_SIZE = 12;

export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<Paginated<StudySetSummary> | null>(null);
  const [facets, setFacets] = useState<DiscoverFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subject = params.get('subject') ?? '';
  const level = params.get('level') ?? '';
  const tag = params.get('tag') ?? '';
  const page = Number(params.get('page') ?? '1');

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await discoverService.search({
        q: params.get('q') ?? '',
        subject: params.get('subject') ?? undefined,
        level: params.get('level') ?? undefined,
        tag: params.get('tag') ?? undefined,
        page: Number(params.get('page') ?? '1'),
        pageSize: PAGE_SIZE,
      });
      setResults(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void search();
  }, [search]);

  useEffect(() => {
    void discoverService
      .facets()
      .then(setFacets)
      .catch(() => undefined);
  }, []);

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  const totalPages = results ? Math.max(1, Math.ceil(results.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Discover</h1>
          <p>Public study sets from the Lerno community — free to use by anyone.</p>
        </div>
      </div>

      <form
        className="filter-bar"
        onSubmit={(e) => {
          e.preventDefault();
          updateParam('q', query.trim() || null);
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 260px' }}>
          <input
            className="input"
            type="search"
            placeholder="Search titles, descriptions and tags…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search public sets"
          />
          <span
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          >
            <IconSearch size={18} />
          </span>
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {facets ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {facets.levels.map((value) => (
            <button
              key={value}
              type="button"
              className={`chip${level === value ? ' chip-active' : ''}`}
              onClick={() => updateParam('level', level === value ? null : value)}
            >
              {value}
            </button>
          ))}
          {facets.subjects.slice(0, 8).map((value) => (
            <button
              key={value}
              type="button"
              className={`chip${subject === value ? ' chip-active' : ''}`}
              onClick={() => updateParam('subject', subject === value ? null : value)}
            >
              {value}
            </button>
          ))}
          {facets.tags.slice(0, 12).map((value) => (
            <button
              key={value}
              type="button"
              className={`chip${tag === value ? ' chip-active' : ''}`}
              onClick={() => updateParam('tag', tag === value ? null : value)}
            >
              #{value}
            </button>
          ))}
          {level || subject || tag || params.get('q') ? (
            <button type="button" className="chip" onClick={() => setParams(new URLSearchParams())}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState title="Search failed" description={error} />
      ) : results && results.items.length > 0 ? (
        <>
          <p className="muted" style={{ marginBottom: 14, fontSize: '0.875rem' }}>
            {results.total} public set{results.total === 1 ? '' : 's'} found
          </p>
          <div className="set-grid">
            {results.items.map((set) => (
              <Link key={set.id} to={`/sets/${set.id}`} className="card card-interactive">
                <div className="set-card-title">{set.title}</div>
                <div className="set-card-desc">{set.description || 'No description'}</div>
                <div className="set-card-footer">
                  <span>{set.authorName}</span>
                  <span>
                    {set.cardCount} cards
                    {set.level ? ` · ${set.level}` : ''}
                  </span>
                </div>
                {set.tags.length > 0 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {set.tags.slice(0, 3).map((value) => (
                      <Badge key={value}>#{value}</Badge>
                    ))}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>

          {totalPages > 1 ? (
            <div
              style={{
                display: 'flex',
                gap: 10,
                justifyContent: 'center',
                marginTop: 24,
                alignItems: 'center',
              }}
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateParam('page', String(page - 1))}
              >
                Previous
              </Button>
              <span className="muted">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => updateParam('page', String(page + 1))}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No public sets found"
          description="Try a different search or filter — or create the first set on this topic."
          action={<ButtonLink to="/sets/new">Create a study set</ButtonLink>}
        />
      )}
    </>
  );
}
