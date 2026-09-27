import { Link } from 'react-router-dom';
import { ButtonLink } from '../components/ui/Button';
import {
  IconBook,
  IconChart,
  IconCheck,
  IconCompass,
  IconLayers,
  IconQuiz,
  IconStar,
  IconZap,
} from '../components/ui/Icons';
import { Logo } from '../components/layout/Logo';
import { ThemeToggle } from '../components/layout/ThemeToggle';
import { useAuth } from '../hooks/useAuth';

const features = [
  {
    icon: <IconLayers />,
    title: 'Flashcards & spaced repetition',
    body: 'Learn cards with a simple review schedule that brings back what you are about to forget — no black-box algorithms.',
  },
  {
    icon: <IconZap />,
    title: 'Practice mode',
    body: 'A focused mix of due, difficult and new cards. The fastest way to drill what actually needs work.',
  },
  {
    icon: <IconQuiz />,
    title: 'Quiz yourself',
    body: 'Multiple choice, true/false and short answer — with clear results that show exactly what to review next.',
  },
  {
    icon: <IconBook />,
    title: 'Create & share sets',
    body: 'Build study sets by hand, paste a list, or import a CSV. Share them publicly or keep them private.',
  },
  {
    icon: <IconCompass />,
    title: 'Discover sets',
    body: 'Search public study sets by subject, level and tags. Start studying in one click — even without an account.',
  },
  {
    icon: <IconChart />,
    title: 'Track progress',
    body: 'Cards studied, accuracy, streaks and per-subject progress. Honest numbers, no vanity metrics.',
  },
];

const steps = [
  {
    title: 'Create or find a set',
    body: 'Make your own study set in minutes, or pick one from the public library.',
  },
  {
    title: 'Study with spaced repetition',
    body: 'Flip cards, mark what you got right or wrong, and let the review schedule do the planning.',
  },
  {
    title: 'Quiz yourself & track progress',
    body: 'Take a short quiz, see what needs more practice, and watch your progress grow.',
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const startHref = user ? '/dashboard' : '/signup';

  return (
    <div>
      <header className="landing-header">
        <div className="container landing-header-inner">
          <Logo />
          <nav className="landing-nav" aria-label="Landing navigation">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#free-first">Free-first</a>
            <Link to="/discover">Explore sets</Link>
          </nav>
          <div className="landing-actions">
            <ThemeToggle />
            {user ? (
              <ButtonLink to="/dashboard" variant="primary">
                Dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">
                  Log in
                </ButtonLink>
                <ButtonLink to="/signup" variant="primary">
                  Start free
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <span className="eyebrow">
                <IconStar size={15} /> Free-first study platform for students
              </span>
              <h1>
                Study smarter.
                <br />
                Pay nothing.
              </h1>
              <p className="lead">
                Lerno helps you learn, practice, quiz and review with flashcards and spaced
                repetition — built for Dutch secondary and MBO students, and free for every core
                feature.
              </p>
              <div className="hero-ctas">
                <ButtonLink to={startHref} size="lg">
                  {user ? 'Continue learning' : 'Start learning free'}
                </ButtonLink>
                <ButtonLink to="/discover" variant="secondary" size="lg">
                  Explore study sets
                </ButtonLink>
              </div>
              <p className="hero-note">
                No account needed to start · No daily limits · No premium paywall
              </p>
            </div>

            <div className="hero-visual" aria-hidden="true">
              <div className="flashcard-preview">
                <span className="fc-label">Flashcard · Biology</span>
                <p className="fc-question">What is the function of mitochondria in a cell?</p>
                <p className="fc-answer">
                  They produce ATP through cellular respiration — the cell&apos;s energy supply.
                </p>
                <div className="fc-actions">
                  <span className="btn btn-secondary btn-sm">Incorrect</span>
                  <span className="btn btn-primary btn-sm">Correct</span>
                </div>
                <div className="fc-progress">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: '62%' }} />
                  </div>
                  <span>18 / 29</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="section section-alt" id="features">
          <div className="container">
            <div className="section-head">
              <h2>Everything you need to actually learn</h2>
              <p>A calm, focused study toolkit — no clutter, no gimmicks.</p>
            </div>
            <div className="feature-grid">
              {features.map((feature) => (
                <div className="feature-card" key={feature.title}>
                  <div className="feature-icon">{feature.icon}</div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="section" id="how-it-works">
          <div className="container">
            <div className="section-head">
              <h2>How it works</h2>
              <p>From &quot;what should I study?&quot; to real progress in three steps.</p>
            </div>
            <div className="steps">
              {steps.map((step, index) => (
                <div className="step" key={step.title}>
                  <div className="step-num">{index + 1}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Free-first promise */}
        <section className="section section-alt" id="free-first">
          <div className="container">
            <div className="promise">
              <h2>Free-first, for real</h2>
              <p style={{ marginTop: 12, maxWidth: '36em', marginInline: 'auto' }}>
                Core learning on Lerno stays free — today and tomorrow. No dark patterns, no
                artificial limits, no &quot;premium&quot; wall around your own study routine.
              </p>
              <ul className="promise-list">
                <li>
                  <span className="promise-check">
                    <IconCheck size={17} />
                  </span>
                  No daily study limits
                </li>
                <li>
                  <span className="promise-check">
                    <IconCheck size={17} />
                  </span>
                  No premium paywall for core features
                </li>
                <li>
                  <span className="promise-check">
                    <IconCheck size={17} />
                  </span>
                  Useful without AI or any paid API
                </li>
                <li>
                  <span className="promise-check">
                    <IconCheck size={17} />
                  </span>
                  Guest learning for public sets
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="section">
          <div className="container cta-band">
            <h2>Ready to start learning?</h2>
            <p style={{ maxWidth: '32em' }}>
              Open Lerno, see today&apos;s review, and make progress in the next five minutes.
            </p>
            <ButtonLink to={startHref} size="lg">
              {user ? 'Go to dashboard' : 'Create your free account'}
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="container landing-footer-inner">
          <Logo />
          <span>Learn · Practice · Quiz · Review</span>
          <span>© {new Date().getFullYear()} Lerno. Made for students.</span>
        </div>
      </footer>
    </div>
  );
}
