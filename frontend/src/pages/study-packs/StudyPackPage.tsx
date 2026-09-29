import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { IconGear, IconTrash } from '../../components/ui/Icons';
import { useToast } from '../../components/ui/Toast';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api';
import { PACK_TABS, packTabHref, parsePackTab } from '../../lib/studyPackRoutes';
import { studyPackService } from '../../services/studyPackService';
import { PackHero } from '../../components/study-pack/PackHero';
import { PackOverview } from '../../components/study-pack/PackOverview';
import { PackGettingStarted, isFreshPack } from '../../components/study-pack/PackGettingStarted';
import { PackLearn } from '../../components/study-pack/PackLearn';
import { PackConcepts } from '../../components/study-pack/PackConcepts';
import { PackFlashcards } from '../../components/study-pack/PackFlashcards';
import { PackPractice } from '../../components/study-pack/PackPractice';
import { PackTest } from '../../components/study-pack/PackTest';
import { PackProgress } from '../../components/study-pack/PackProgress';
import { PackSources } from '../../components/study-pack/PackSources';
import { PackTutor } from '../../components/study-pack/PackTutor';
import { PackSettingsModal } from '../../components/study-pack/PackSettingsModal';
import type { StudyPackDetail } from '../../types';

/**
 * The Study Pack page: one learning environment with everything a pack needs —
 * material, overview, concepts, flashcards, practice, tests, progress and tutor.
 */
export function StudyPackPage() {
  const { packId } = useParams<{ packId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: pack, loading, error, reload } = useAsync<StudyPackDetail>(
    () => studyPackService.get(packId ?? ''),
    [packId],
  );

  if (loading) return <LoadingRow large />;

  if (error || !pack) {
    const unauthorized = error !== null && /log in/i.test(error);
    return (
      <EmptyState
        title={unauthorized ? 'Log in to open this study pack' : 'Study pack not found'}
        description={
          unauthorized
            ? 'This pack belongs to another student.'
            : (error ?? 'This pack does not exist or is private.')
        }
        action={
          unauthorized ? (
            <ButtonLink to={`/login?next=${encodeURIComponent(`/study-packs/${packId ?? ''}`)}`}>
              Log in
            </ButtonLink>
          ) : (
            <ButtonLink to="/study-packs">Back to study packs</ButtonLink>
          )
        }
      />
    );
  }

  const tab = parsePackTab(`?${searchParams.toString()}`);
  const conceptParam = searchParams.get('concept') ?? undefined;

  async function removePack() {
    if (!pack || !window.confirm(`Delete "${pack.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await studyPackService.remove(pack.id);
      toast.show('Study pack deleted');
      navigate('/study-packs');
    } catch (requestError) {
      toast.show(
        requestError instanceof ApiError ? requestError.message : 'Could not delete this pack',
        'error',
      );
      setDeleting(false);
    }
  }

  return (
    <div className="study-pack-page">
      {!user ? (
        <div className="guest-banner">
          <p>Studying as a guest — progress on this pack is not saved to an account.</p>
          <ButtonLink to="/signup" size="sm">
            Create an account
          </ButtonLink>
        </div>
      ) : null}

      <PackHero pack={pack} tab={tab} />

      <div className="pack-tabbar">
        <nav className="tabs" aria-label="Study pack sections">
          {PACK_TABS.map((entry) => (
            <Link
              key={entry.id}
              to={packTabHref(entry.id, entry.id === 'practice' && conceptParam ? { concept: conceptParam } : undefined)}
              className={`tab${tab === entry.id ? ' tab-active' : ''}`}
              aria-current={tab === entry.id ? 'page' : undefined}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        {pack.isOwner ? (
          <div className="pack-owner-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Study pack settings"
              onClick={() => setSettingsOpen(true)}
            >
              <IconGear size={17} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              aria-label="Delete study pack"
              onClick={() => void removePack()}
              disabled={deleting}
            >
              <IconTrash size={17} />
            </button>
          </div>
        ) : null}
      </div>

      <div className="pack-tab-content">
        {tab === 'overview' ? (
          <div className="stack" style={{ gap: 24 }}>
            {isFreshPack(pack) ? <PackGettingStarted pack={pack} /> : null}
            <PackOverview pack={pack} onChanged={reload} />
          </div>
        ) : null}

        {tab === 'learn' ? (
          <PackLearn pack={pack} focusConceptId={conceptParam} onChanged={reload} />
        ) : null}

        {tab === 'concepts' ? <PackConcepts pack={pack} onChanged={reload} /> : null}

        {tab === 'flashcards' ? <PackFlashcards pack={pack} onChanged={reload} /> : null}

        {tab === 'practice' ? (
          <PackPractice pack={pack} focusConceptId={conceptParam} onChanged={reload} />
        ) : null}

        {tab === 'test' ? <PackTest pack={pack} onChanged={reload} /> : null}

        {tab === 'progress' ? <PackProgress pack={pack} onChanged={reload} /> : null}

        {tab === 'sources' ? <PackSources pack={pack} onChanged={reload} /> : null}

        {tab === 'tutor' ? <PackTutor pack={pack} /> : null}
      </div>

      {pack.isOwner ? (
        <PackSettingsModal
          pack={pack}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSaved={reload}
        />
      ) : null}

      <p className="muted pack-footer-note">
        {pack.isOwner ? (
          <>
            This pack is {pack.visibility === 'public' ? 'public' : 'private'} ·{' '}
            {pack.counts.sources} source{pack.counts.sources === 1 ? '' : 's'} · created{' '}
            {new Date(pack.createdAt).toLocaleDateString()} <Badge>{pack.level || 'No level set'}</Badge>
          </>
        ) : (
          <>
            Shared study pack by another student. Your progress stays on your own account.
          </>
        )}
      </p>
    </div>
  );
}
