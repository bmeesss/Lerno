import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './components/layout/RequireAuth';
import { LoadingRow } from './components/ui/Primitives';
import { DiscoverPage } from './pages/DiscoverPage';
import { FavoritesPage } from './pages/FavoritesPage';
import { AdminPage } from './pages/AdminPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SignupPage } from './pages/auth/SignupPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { MySetsPage } from './pages/sets/MySetsPage';
import { SetDetailPage } from './pages/sets/SetDetailPage';
import { SetEditorPage } from './pages/sets/SetEditorPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProgressPage } from './pages/ProgressPage';
import { SettingsPage } from './pages/SettingsPage';
import { QuizPage } from './pages/quiz/QuizPage';
import { ReviewPage } from './pages/ReviewPage';
import { PracticePage } from './pages/study/PracticePage';
import { StudyPage } from './pages/study/StudyPage';
import { SubjectDetailPage } from './pages/subjects/SubjectDetailPage';
import { SubjectsPage } from './pages/subjects/SubjectsPage';

function authed(element: React.ReactNode) {
  return <RequireAuth>{element}</RequireAuth>;
}

// Lazy: keeps @supabase/supabase-js (OAuth consent only) out of the main bundle.
const OAuthConsentPage = lazy(() =>
  import('./pages/oauth/OAuthConsentPage').then((module) => ({ default: module.OAuthConsentPage })),
);

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/oauth/consent"
        element={authed(
          <Suspense fallback={<LoadingRow large />}>
            <OAuthConsentPage />
          </Suspense>,
        )}
      />

      {/* App shell (guest-friendly routes included — spec §8) */}
      <Route element={<AppShell />}>
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/sets/:setId" element={<SetDetailPage />} />
        <Route path="/sets/:setId/study" element={<StudyPage />} />
        <Route path="/sets/:setId/practice" element={<PracticePage />} />
        <Route path="/sets/:setId/quiz" element={<QuizPage />} />

        {/* Authenticated */}
        <Route path="/dashboard" element={authed(<DashboardPage />)} />
        <Route path="/subjects" element={authed(<SubjectsPage />)} />
        <Route path="/subjects/:subjectId" element={authed(<SubjectDetailPage />)} />
        <Route path="/sets" element={authed(<MySetsPage />)} />
        <Route path="/sets/new" element={authed(<SetEditorPage />)} />
        <Route path="/sets/:setId/edit" element={authed(<SetEditorPage />)} />
        <Route path="/review" element={authed(<ReviewPage />)} />
        <Route path="/favorites" element={authed(<FavoritesPage />)} />
        <Route path="/progress" element={authed(<ProgressPage />)} />
        <Route path="/profile" element={authed(<ProfilePage />)} />
        <Route path="/profile/:userId" element={<ProfilePage />} />
        <Route path="/settings" element={authed(<SettingsPage />)} />
        <Route path="/admin" element={authed(<AdminPage />)} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
