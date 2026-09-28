/**
 * App shell — desktop sidebar + mobile top bar / bottom navigation
 * (spec §5). Pure layout; no business logic.
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Avatar } from '../ui/Primitives';
import {
  IconBook,
  IconChart,
  IconCompass,
  IconGear,
  IconHeart,
  IconHome,
  IconLayers,
  IconShield,
  IconSparkles,
  IconUser,
} from '../ui/Icons';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Grouped sidebar navigation: study first, library second, account last. */
const desktopNav: NavGroup[] = [
  {
    label: 'Study',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: <IconHome /> },
      { to: '/ai', label: 'Lerno AI', icon: <IconSparkles /> },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/subjects', label: 'My subjects', icon: <IconBook /> },
      { to: '/sets', label: 'My sets', icon: <IconLayers /> },
      { to: '/discover', label: 'Discover', icon: <IconCompass /> },
      { to: '/favorites', label: 'Favorites', icon: <IconHeart /> },
    ],
  },
  {
    label: 'You',
    items: [
      { to: '/progress', label: 'Progress', icon: <IconChart /> },
      { to: '/settings', label: 'Settings', icon: <IconGear /> },
    ],
  },
];

const mobileNav: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: <IconHome /> },
  { to: '/review', label: 'Learn', icon: <IconBook /> },
  { to: '/sets', label: 'Sets', icon: <IconLayers /> },
  { to: '/discover', label: 'Discover', icon: <IconCompass /> },
  { to: '/profile', label: 'Profile', icon: <IconUser /> },
];

function NavItems({ items, variant }: { items: NavItem[]; variant: 'desktop' | 'mobile' }) {
  const base = variant === 'desktop' ? 'sidebar-link' : 'mobile-nav-link';
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `${base}${isActive ? ' active' : ''}`}
        >
          {item.icon}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </>
  );
}

function DesktopNavGroups({ groups }: { groups: NavGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="nav-group">
          <div className="nav-group-label" aria-hidden="true">
            {group.label}
          </div>
          <NavItems items={group.items} variant="desktop" />
        </div>
      ))}
    </>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Logo to="/dashboard" />
        <nav className="sidebar-nav" aria-label="Main navigation">
          <DesktopNavGroups groups={desktopNav} />
          {user?.profile.role === 'admin' ? (
            <NavLink
              to="/admin"
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            >
              <IconShield />
              <span>Admin</span>
            </NavLink>
          ) : null}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <Avatar name={user?.profile.displayName ?? 'Guest'} />
            <div style={{ minWidth: 0 }}>
              <div className="sidebar-user-name">{user ? user.profile.displayName : 'Guest'}</div>
              <div className="sidebar-user-email">{user ? user.email : 'Not signed in'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ThemeToggle />
            {user ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
                Log out
              </button>
            ) : (
              <NavLink to="/login" className="btn btn-primary btn-sm">
                Log in
              </NavLink>
            )}
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <Logo to={user ? '/dashboard' : '/'} />
          <div className="topbar-actions">
            <ThemeToggle />
            {user ? (
              <NavLink to="/profile" aria-label="Profile">
                <Avatar name={user.profile.displayName} />
              </NavLink>
            ) : (
              <NavLink to="/login" className="btn btn-primary btn-sm">
                Log in
              </NavLink>
            )}
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavItems items={mobileNav} variant="mobile" />
      </nav>
    </div>
  );
}
