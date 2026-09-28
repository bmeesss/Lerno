import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Avatar } from '../ui/Primitives';
import { Modal } from '../ui/Modal';
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
  IconSearch,
  IconPlus,
  IconArrowRight,
} from '../ui/Icons';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const groups = [
  {
    label: 'Study',
    items: [
      { to: '/dashboard', label: 'Dashboard', Icon: IconHome },
      { to: '/ai', label: 'Lerno AI', Icon: IconSparkles },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/subjects', label: 'My subjects', Icon: IconBook },
      { to: '/sets', label: 'My sets', Icon: IconLayers },
      { to: '/discover', label: 'Discover', Icon: IconCompass },
      { to: '/favorites', label: 'Favorites', Icon: IconHeart },
    ],
  },
  {
    label: 'You',
    items: [
      { to: '/progress', label: 'Progress', Icon: IconChart },
      { to: '/settings', label: 'Settings', Icon: IconGear },
    ],
  },
];
const mobileItems = [
  groups[0]!.items[0]!,
  groups[0]!.items[1]!,
  groups[1]!.items[1]!,
  groups[1]!.items[2]!,
];

function Navigation({ close }: { close?: () => void }) {
  const { user } = useAuth();
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="nav-group">
          <div className="nav-group-label">{group.label}</div>
          {group.items.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={close}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {to === '/ai' && <span className="nav-ai-badge">AI</span>}
            </NavLink>
          ))}
        </div>
      ))}
      {user?.profile.role === 'admin' && (
        <NavLink to="/admin" onClick={close} className="sidebar-link">
          <IconShield />
          Admin
        </NavLink>
      )}
    </>
  );
}

/** Navigation and focus-mode are presentation only; study/session logic is unchanged. */
export function AppShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const focusMatch = pathname.match(/^\/sets\/([^/]+)\/(study|practice|quiz|ai-study)$/);
  const pageTitle =
    groups
      .flatMap((group) => group.items)
      .find((item) => pathname === item.to || pathname.startsWith(item.to + '/'))?.label ??
    'Your workspace';

  return (
    <div className={`app-shell${focusMatch ? ' app-shell-focus' : ''}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {!focusMatch && (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <Logo to="/dashboard" />
            <span className="brand-caption">A little learning, every day.</span>
          </div>
          <Link to="/sets/new" className="btn btn-primary sidebar-create">
            <IconPlus size={17} /> Create a set
          </Link>
          <nav className="sidebar-nav" aria-label="Main navigation">
            <Navigation />
          </nav>
          <div className="sidebar-footer">
            <Link className="sidebar-user" to={user ? '/profile' : '/login'}>
              <Avatar name={user?.profile.displayName ?? 'Guest'} />
              <div className="sidebar-user-copy">
                <div className="sidebar-user-name">{user?.profile.displayName ?? 'Guest'}</div>
                <div className="sidebar-user-email">
                  {user ? 'Personal workspace' : 'Log in to save progress'}
                </div>
              </div>
              <IconArrowRight size={16} />
            </Link>
            <div className="sidebar-footer-actions">
              <ThemeToggle />
              {user ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void logout()}
                >
                  Log out
                </button>
              ) : (
                <Link to="/login" className="btn btn-ghost btn-sm">
                  Log in
                </Link>
              )}
            </div>
          </div>
        </aside>
      )}

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-brand">
            <Logo to={user ? '/dashboard' : '/'} />
          </div>
          <div className="workspace-crumb">
            <span>{focusMatch ? 'Focus session' : 'Your workspace'}</span>
            <span aria-hidden="true">/</span>
            <strong>
              {focusMatch
                ? focusMatch[2] === 'ai-study'
                  ? 'AI study'
                  : focusMatch[2]!.replace(/^./, (c) => c.toUpperCase())
                : pageTitle}
            </strong>
          </div>
          {!focusMatch && (
            <form
              className="topbar-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                const query = new FormData(e.currentTarget).get('q')?.toString().trim();
                navigate(`/discover${query ? `?q=${encodeURIComponent(query)}` : ''}`);
              }}
            >
              <IconSearch size={17} />
              <input
                name="q"
                aria-label="Search the public library"
                placeholder="Search the library…"
              />
              <button type="submit" className="visually-hidden">
                Search
              </button>
            </form>
          )}
          <div className="topbar-actions">
            {focusMatch ? (
              <Link to={`/sets/${focusMatch[1]}`} className="btn btn-secondary btn-sm">
                Back to set
              </Link>
            ) : (
              <Link
                to={user ? '/profile' : '/login'}
                className="topbar-profile"
                aria-label={user ? 'Profile' : 'Log in'}
              >
                <Avatar name={user?.profile.displayName ?? 'Guest'} />
              </Link>
            )}
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="app-content">
          <Outlet />
        </main>
      </div>

      {!focusMatch && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {mobileItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `mobile-nav-link${isActive ? ' active' : ''}`}
            >
              <Icon />
              <span>{label === 'Dashboard' ? 'Home' : label === 'My sets' ? 'Sets' : label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            className={`mobile-nav-link${menuOpen || !mobileItems.some((item) => pathname === item.to || pathname.startsWith(item.to + '/')) ? ' active' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <IconUser />
            <span>More</span>
          </button>
        </nav>
      )}
      <Modal open={menuOpen} title="Your workspace" onClose={() => setMenuOpen(false)}>
        <nav className="mobile-menu" aria-label="All pages">
          <Navigation close={() => setMenuOpen(false)} />
          <Link to="/profile" className="sidebar-link" onClick={() => setMenuOpen(false)}>
            <IconUser />
            Profile
          </Link>
        </nav>
        <div className="sidebar-footer-actions">
          <ThemeToggle />
          {user && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setMenuOpen(false);
                void logout();
              }}
            >
              Log out
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
