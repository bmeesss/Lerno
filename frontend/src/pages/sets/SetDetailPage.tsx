import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, EmptyState, LoadingRow } from '../../components/ui/Primitives';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/ui/Toast';
import { ReportModal } from '../../components/moderation/ReportModal';
import { IconEdit, IconFlag, IconHeart, IconStar, IconTrash } from '../../components/ui/Icons';
import { AiSetActions } from '../../components/ai/AiSetActions';
import { AiCardActions } from '../../components/ai/AiCardActions';
import { ApiError } from '../../lib/api';
import { favoriteService } from '../../services/favoriteService';
import { studySetService } from '../../services/studySetService';
import type { StudySetDetail } from '../../types';

export function SetDetailPage() {
  const { setId } = useParams<{ setId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error } = useAsync<StudySetDetail>(
    () => studySetService.get(setId ?? ''),
    [setId],
  );
  const [favorited, setFavorited] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  if (loading) return <LoadingRow large />;
  if (error || !data) {
    return (
      <EmptyState
        title="Study set not found"
        description={error ?? 'This set does not exist or is private.'}
        action={<ButtonLink to="/discover">Browse public sets</ButtonLink>}
      />
    );
  }

  const isFavorited = favorited ?? data.favorited;

  async function toggleFavorite() {
    if (!user) {
      navigate('/login?next=' + encodeURIComponent(`/sets/${setId}`));
      return;
    }
    try {
      if (isFavorited) {
        await favoriteService.remove(data!.id);
        setFavorited(false);
        toast.show('Removed from favorites');
      } else {
        await favoriteService.add(data!.id);
        setFavorited(true);
        toast.show('Saved to favorites');
      }
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not update favorites', 'error');
    }
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.show('Link copied to clipboard', 'success');
      } else {
        window.prompt('Copy this link', url);
      }
    } catch {
      window.prompt('Copy this link', url);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Delete "${data!.title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await studySetService.remove(data!.id);
      toast.show('Study set deleted');
      navigate('/sets');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not delete set', 'error');
      setBusy(false);
    }
  }

  return (
    <>
      {!user ? (
        <div className="guest-banner">
          <p>Studying as a guest — progress is kept on this device only.</p>
          <ButtonLink to="/signup" size="sm">
            Create an account to save progress
          </ButtonLink>
        </div>
      ) : null}

      <div className="set-hero">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div>
            <h1>{data.title}</h1>
            <div className="set-meta" style={{ marginTop: 10 }}>
              {data.subjectName ? <Badge variant="accent">{data.subjectName}</Badge> : null}
              {data.level ? <Badge>{data.level}</Badge> : null}
              <Badge>{data.cardCount} cards</Badge>
              <Badge>{data.visibility === 'public' ? 'Public' : 'Private'}</Badge>
              {data.tags.map((tag) => (
                <Link key={tag} to={`/discover?tag=${encodeURIComponent(tag)}`} className="chip">
                  #{tag}
                </Link>
              ))}
            </div>
            <p style={{ marginTop: 12, maxWidth: '46em' }}>
              {data.description || 'No description yet.'}
            </p>
            <p className="muted" style={{ marginTop: 8, fontSize: '0.875rem' }}>
              By{' '}
              <Link to={`/profile/${data.ownerId}`} style={{ color: 'var(--accent-text)' }}>
                {data.authorName}
              </Link>
            </p>
          </div>
        </div>

        <div className="set-actions">
          <ButtonLink to={`/sets/${data.id}/study`} size="lg">
            Study
          </ButtonLink>
          <ButtonLink to={`/sets/${data.id}/practice`} variant="secondary" size="lg">
            Practice
          </ButtonLink>
          <ButtonLink to={`/sets/${data.id}/quiz`} variant="secondary" size="lg">
            Quiz
          </ButtonLink>
          <AiSetActions setId={data.id} signedIn={Boolean(user)} />
          <Button variant="secondary" size="lg" onClick={() => void toggleFavorite()}>
            {isFavorited ? <IconHeart size={18} /> : <IconStar size={18} />}
            {isFavorited ? 'Favorited' : 'Favorite'}
          </Button>
          <Button variant="ghost" size="lg" onClick={() => void share()}>
            Share
          </Button>
          {!data.isOwner ? (
            <Button variant="ghost" size="lg" onClick={() => setReportOpen(true)}>
              <IconFlag size={18} /> Report
            </Button>
          ) : null}
          {data.isOwner ? (
            <>
              <ButtonLink to={`/sets/${data.id}/edit`} variant="ghost" size="lg">
                <IconEdit size={18} /> Edit
              </ButtonLink>
              <Button variant="danger" size="lg" disabled={busy} onClick={() => void onDelete()}>
                <IconTrash size={18} /> Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="section-title">
        <h2>Cards ({data.cards.length})</h2>
      </div>
      {data.cards.length > 0 ? (
        <div className="cards-list">
          {data.cards.map((card) => (
            <div key={card.id} className="card-row">
              <div className="card-q">{card.question}</div>
              <div className="card-a">{card.answer}</div>
              <div className="card-row-meta">
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  #{card.position + 1}
                </span>
                <AiCardActions
                  cardId={card.id}
                  setId={data.id}
                  signedIn={Boolean(user)}
                  label={card.question}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No cards yet"
          description={
            data.isOwner
              ? 'Add cards to make this set studyable.'
              : 'The author has not added cards yet.'
          }
          action={
            data.isOwner ? (
              <ButtonLink to={`/sets/${data.id}/edit`}>Add cards</ButtonLink>
            ) : undefined
          }
        />
      )}

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="study_set"
        targetId={data.id}
        targetLabel="study set"
      />
    </>
  );
}
