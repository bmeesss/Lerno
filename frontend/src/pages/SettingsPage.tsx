import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ThemeToggle } from '../components/layout/ThemeToggle';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../components/ui/Toast';
import { guestProgress } from '../services/guestProgress';

const TIME_ZONES = [
  'UTC',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function SettingsPage() {
  const { user, logout, updateProfile } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmClear, setConfirmClear] = useState(false);
  const [savingZone, setSavingZone] = useState(false);

  async function onLogout() {
    await logout();
    navigate('/');
  }

  async function onZoneChange(timezone: string) {
    if (timezone === user?.profile.timezone) return;
    setSavingZone(true);
    try {
      await updateProfile({ timezone });
      toast.show('Time zone saved', 'success');
    } catch {
      toast.show('Could not save your time zone — try again.', 'error');
    } finally {
      setSavingZone(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Profile, theme, account and privacy.</p>
        </div>
      </div>

      <div className="stack" style={{ gap: 16, maxWidth: 640 }}>
        <section className="card">
          <div className="stat-label">Profile</div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{user?.profile.displayName}</div>
              <div className="muted" style={{ fontSize: '0.875rem' }}>
                {user?.email}
              </div>
            </div>
            <Button variant="secondary" onClick={() => navigate('/profile')}>
              Edit profile
            </Button>
          </div>
        </section>

        <section className="card">
          <div className="stat-label">Theme</div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{theme === 'dark' ? 'Dark' : 'Light'} mode</div>
              <div className="muted" style={{ fontSize: '0.875rem' }}>
                Lerno looks best in the dark — but the choice is yours.
              </div>
            </div>
            <ThemeToggle />
          </div>
        </section>

        <section className="card">
          <div className="stat-label">Time zone</div>
          <p style={{ margin: '8px 0 14px', fontSize: '0.925rem' }}>
            Lerno groups your streaks, reviews and “today” progress by calendar day in this time
            zone.
          </p>
          <div className="field">
            <label htmlFor="settings-timezone">Time zone</label>
            <select
              id="settings-timezone"
              className="select input"
              value={user?.profile.timezone ?? 'UTC'}
              disabled={savingZone}
              onChange={(e) => void onZoneChange(e.target.value)}
            >
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
            {savingZone ? (
              <div className="muted" style={{ fontSize: '0.875rem' }}>
                Saving…
              </div>
            ) : null}
          </div>
        </section>

        <section className="card">
          <div className="stat-label">Privacy</div>
          <p style={{ margin: '8px 0 14px', fontSize: '0.925rem' }}>
            Your study sets are private unless you make them public. Guest study data lives only on
            this device and never leaves it.
          </p>
          <Button variant="secondary" onClick={() => setConfirmClear(true)}>
            Clear guest data on this device
          </Button>
        </section>

        <section className="card">
          <div className="stat-label">Account</div>
          <p style={{ margin: '8px 0 14px', fontSize: '0.925rem' }}>
            Logging out ends this session on this device. Your study progress stays safe.
          </p>
          <Button variant="danger" onClick={() => void onLogout()}>
            Log out
          </Button>
        </section>
      </div>

      <Modal
        open={confirmClear}
        title="Clear guest data?"
        onClose={() => setConfirmClear(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                guestProgress.clearAll();
                setConfirmClear(false);
                toast.show('Guest data cleared', 'success');
              }}
            >
              Clear data
            </Button>
          </>
        }
      >
        <p>
          This removes flashcard progress that guests saved on this device. Your account data is not
          affected.
        </p>
      </Modal>
    </>
  );
}
