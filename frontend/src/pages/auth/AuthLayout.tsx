import type { ReactNode } from 'react';
import { Logo } from '../../components/layout/Logo';
import { ThemeToggle } from '../../components/layout/ThemeToggle';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Logo />
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
