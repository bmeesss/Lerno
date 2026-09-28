import { ButtonLink } from '../components/ui/Button';
import { Logo } from '../components/layout/Logo';

export function NotFoundPage() {
  return (
    <div className="auth-page">
      <Logo />
      <div className="auth-card not-found-card" style={{ textAlign: 'center' }}>
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist or has moved.</p>
        <ButtonLink to="/" block>
          Back to home
        </ButtonLink>
      </div>
    </div>
  );
}
