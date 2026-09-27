import { Link } from 'react-router-dom';
import { ButtonLink } from '../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../components/ui/Primitives';
import { IconBook, IconZap } from '../components/ui/Icons';
import { useAsync } from '../hooks/useAsync';
import { studyService } from '../services/studyService';
import type { DueGroup } from '../types';

export function ReviewPage() {
  const { data, loading, error } = useAsync<DueGroup[]>(() => studyService.dueGroups(), []);

  const totalDue = (data ?? []).reduce((sum, group) => sum + group.dueCount, 0);

  // Group due sets under subject headings, preserving due-date order.
  const bySubject = new Map<string, { name: string; groups: NonNullable<typeof data> }>();
  for (const group of data ?? []) {
    const name = group.subjectName ?? 'No subject';
    const entry = bySubject.get(name) ?? { name, groups: [] };
    entry.groups.push(group);
    bySubject.set(name, entry);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Review</h1>
          <p>Everything due right now, grouped by set. Clear it and keep your streak alive.</p>
        </div>
        {totalDue > 0 ? (
          <ButtonLink to={`/sets/${data![0]!.setId}/study`}>
            <IconZap size={17} /> Start reviewing
          </ButtonLink>
        ) : null}
      </div>

      {loading ? (
        <LoadingRow large />
      ) : error ? (
        <EmptyState title="Could not load reviews" description={error} />
      ) : data && data.length > 0 ? (
        <>
          <div className="quick-start" style={{ marginBottom: 20 }}>
            <div>
              <h2>
                {totalDue} card{totalDue === 1 ? '' : 's'} due
              </h2>
              <p className="muted">
                Due cards come first — difficult and new cards wait in practice mode.
              </p>
            </div>
            <ButtonLink to={`/sets/${data[0]!.setId}/practice`} variant="secondary">
              Practice instead
            </ButtonLink>
          </div>

          <div className="stack" style={{ gap: 20 }}>
            {[...bySubject.values()].map((subject) => (
              <section key={subject.name}>
                <div className="section-title" style={{ marginTop: 0 }}>
                  <h2>{subject.name}</h2>
                  <span className="muted" style={{ fontSize: '0.825rem' }}>
                    {subject.groups.reduce((sum, group) => sum + group.dueCount, 0)} due
                  </span>
                </div>
                <div className="stack" style={{ gap: 12 }}>
                  {subject.groups.map((group) => (
                    <div key={group.setId} className="list-row">
                      <IconBook size={20} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{group.setTitle}</div>
                        <div className="muted" style={{ fontSize: '0.825rem' }}>
                          {group.nextReviewAt
                            ? `Oldest due ${new Date(group.nextReviewAt).toLocaleDateString()}`
                            : 'Due now'}
                        </div>
                      </div>
                      <Badge variant="accent">{group.dueCount} due</Badge>
                      <Link to={`/sets/${group.setId}/study`} className="btn btn-primary btn-sm">
                        Study
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          title="All caught up 🎉"
          description="No cards are due right now. Start a practice session or learn something new."
          action={
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <ButtonLink to="/discover">Discover sets</ButtonLink>
              <ButtonLink to="/sets/new" variant="secondary">
                Create a study set
              </ButtonLink>
            </div>
          }
        />
      )}
    </>
  );
}
