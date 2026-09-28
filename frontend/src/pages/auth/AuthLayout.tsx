import type { ReactNode } from 'react';
import { Logo } from '../../components/layout/Logo';
import { ThemeToggle } from '../../components/layout/ThemeToggle';
import { IconBook, IconCheck, IconLayers, IconSparkles } from '../../components/ui/Icons';

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
      <header className="auth-topbar">
        <Logo />
        <ThemeToggle />
      </header>
      <div className="auth-layout">
        <aside className="auth-story">
          <div className="eyebrow-label">Your space to grow</div>
          <h2>
            Big ideas.
            <br />
            Little breakthroughs.
          </h2>
          <p>
            A calmer place for your notes, your questions,
            <br className="auth-linebreak" /> and everything you’re about to learn.
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="auth-paper auth-paper-back">
              <IconLayers size={26} />
              <span>Make it stick.</span>
            </div>
            <div className="auth-paper auth-paper-front">
              <span className="auth-paper-label">
                <IconBook size={17} /> A moment of discovery
              </span>
              <strong>How does a little practice make a big difference?</strong>
              <div className="auth-paper-rule" />
              <p>
                One connection.
                <br />
                One question.
                <br />
                One day at a time.
              </p>
              <span className="auth-paper-success">
                <IconCheck size={16} /> You’re getting there.
              </span>
            </div>
            <span className="auth-spark">
              <IconSparkles size={24} />
            </span>
          </div>
          <div className="auth-promise">
            <IconCheck size={17} /> Free to start. Built for your pace.
          </div>
        </aside>
        <main className="auth-card">
          <div className="auth-form-heading">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </main>
      </div>
      <footer className="auth-footer">
        A little learning, every day. <span>That’s Lerno.</span>
      </footer>
    </div>
  );
}
