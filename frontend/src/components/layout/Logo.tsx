import { Link } from 'react-router-dom';

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="logo" aria-label="Lerno home">
      <span className="logo-mark">L</span>
      <span>Lerno</span>
    </Link>
  );
}
