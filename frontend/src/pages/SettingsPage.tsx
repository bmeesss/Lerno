import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ThemeToggle } from '../components/layout/ThemeToggle';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../components/ui/Toast';
import { guestProgress } from '../services/guestProgress';

export function SettingsPage() {
  const { user, logout } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmClear, setConfirmClear] = useState(false);

  async function onLogout() {
    await logout();
    navigate('/');
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
