import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ButtonLink } from '../components/ui/Button';
import { Avatar, Badge, EmptyState, LoadingRow } from '../components/ui/Primitives';
import { Modal } from '../components/ui/Modal';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/ui/Toast';
import { ApiError } from '../lib/api';
import { discoverService, type PublicProfile } from '../services/discoverService';
import { progressService } from '../services/progressService';
import { studySetService } from '../services/studySetService';
import type { ProgressStats, StudySetSummary } from '../types';

export function ProfilePage() {
  const { userId } = useParams<{ userId?: string }>();
  return userId ? <PublicProfileView userId={userId} /> : <OwnProfileView />;
}

function OwnProfileView() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const { data: stats, loading: statsLoading } = useAsync<ProgressStats>(
    () => progressService.get(),
    [],
  );
  const { data: sets, loading: setsLoading } = useAsync<StudySetSummary[]>(
    () => studySetService.listMine(),
    [],
  );
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.profile.displayName ?? '');
  const [busy, setBusy] = useState(false);

  if (!user) return <LoadingRow large />;

  const publicSets = (sets ?? []).filter((set) => set.visibility === 'public');

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile({ displayName: displayName.trim() });
      setEditing(false);
      toast.show('Profile updated', 'success');
    } catch (err) {
      toast.show(err instanceof ApiError ? err.message : 'Could not update profile', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Avatar name={user.profile.displayName} large />
          <div>
            <h1>{user.profile.displayName}</h1>
            <p>{user.email}</p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit profile
        </Button>
      </div>

      {stats ? (
        <div className="dash-grid" style={{ marginBottom: 28 }}>
          <div className="card stat-card">
            <div className="stat-label">Cards studied</div>
            <div className="stat-value">{stats.cardsStudied}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Quiz attempts</div>
            <div className="stat-value">{stats.quizAttempts}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Streak</div>
            <div className="stat-value">{stats.streakDays} 🔥</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Study time</div>
            <div className="stat-value">{stats.studyTimeMinutes}m</div>
          </div>
        </div>
      ) : statsLoading ? (
        <LoadingRow />
      ) : null}

      <div className="section-title">
        <h2>Public sets</h2>
        <Link to="/sets" className="muted" style={{ fontSize: '0.875rem' }}>
          Manage all sets
        </Link>
      </div>
      {setsLoading ? (
        <LoadingRow />
      ) : publicSets.length > 0 ? (
        <div className="set-grid">
          {publicSets.map((set) => (
            <Link key={set.id} to={`/sets/${set.id}`} className="card card-interactive">
              <div className="set-card-title">{set.title}</div>
              <div className="set-card-desc">{set.description || 'No description'}</div>
              <div className="set-card-footer">
                <Badge variant="accent">Public</Badge>
                <span>{set.cardCount} cards</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No public sets yet"
          description="Set a study set's visibility to public to share it with other students."
          action={<ButtonLink to="/sets">Go to my sets</ButtonLink>}
        />
      )}

      <Modal
        open={editing}
        title="Edit profile"
        onClose={() => setEditing(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={(e) => void onSave(e as unknown as FormEvent)} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => void onSave(e)}>
          <div className="field">
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              required
            />
          </div>
          <button type="submit" className="visually-hidden">
            Save
          </button>
        </form>
      </Modal>
    </>
  );
}

function PublicProfileView({ userId }: { userId: string }) {
  const { user } = useAuth();
  const { data, loading, error } = useAsync<PublicProfile>(
    () => discoverService.publicProfile(userId),
    [userId],
  );

  if (loading) return <LoadingRow large />;
  if (error || !data) {
    return <EmptyState title="Profile not found" description={error ?? 'Unknown user'} />;
  }

  const isSelf = user?.id === userId;

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Avatar name={data.profile.displayName} large />
          <div>
            <h1>{data.profile.displayName}</h1>
            <p>
              {data.stats.publicSetCount} public set{data.stats.publicSetCount === 1 ? '' : 's'}
              {data.stats.quizAccuracy !== null
                ? ` · ${Math.round(data.stats.quizAccuracy * 100)}% quiz accuracy`
                : ''}
            </p>
          </div>
        </div>
        {isSelf ? (
          <ButtonLink to="/profile" variant="secondary">
            My profile
          </ButtonLink>
        ) : null}
      </div>

      <div className="section-title">
        <h2>Public sets</h2>
      </div>
      {data.publicSets.length > 0 ? (
        <div className="set-grid">
          {data.publicSets.map((set) => (
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
          title="No public sets"
          description="This student has not shared any study sets publicly yet."
        />
      )}
    </>
  );
}
