import { Link } from 'react-router-dom';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Lerno home">
      <span className="logo-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6 4v15h13v-4H10V4H6Z" fill="currentColor" />
          <path d="m13 5 5-1 1 5-5 1-1-5Z" fill="currentColor" opacity=".6" />
        </svg>
      </span>
      <span>Lerno</span>
    </Link>
  );
}
