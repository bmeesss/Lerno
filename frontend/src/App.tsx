import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './components/layout/RequireAuth';
import { PlaceholderPage } from './components/PlaceholderPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SignupPage } from './pages/auth/SignupPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* App shell (guest-friendly routes included) */}
      <Route element={<AppShell />}>
        <Route path="/discover" element={<PlaceholderPage title="Discover" description="Search public study sets." />} />
        <Route path="/sets/:setId" element={<PlaceholderPage title="Study set" description="Set overview." />} />
        <Route path="/sets/:setId/study" element={<PlaceholderPage title="Flashcards" description="Study flow." />} />
        <Route path="/sets/:setId/practice" element={<PlaceholderPage title="Practice" description="Practice mode." />} />
        <Route path="/sets/:setId/quiz" element={<PlaceholderPage title="Quiz" description="Quiz mode." />} />

        {/* Authenticated */}
        <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="/subjects" element={<RequireAuth><PlaceholderPage title="My subjects" description="Organize your sets." /></RequireAuth>} />
        <Route path="/subjects/:subjectId" element={<RequireAuth><PlaceholderPage title="Subject" description="Subject detail." /></RequireAuth>} />
        <Route path="/sets" element={<RequireAuth><PlaceholderPage title="My sets" description="Your study sets." /></RequireAuth>} />
        <Route path="/sets/new" element={<RequireAuth><PlaceholderPage title="Create set" description="Set editor." /></RequireAuth>} />
        <Route path="/sets/:setId/edit" element={<RequireAuth><PlaceholderPage title="Edit set" description="Set editor." /></RequireAuth>} />
        <Route path="/review" element={<RequireAuth><PlaceholderPage title="Review" description="Cards due today." /></RequireAuth>} />
        <Route path="/favorites" element={<RequireAuth><PlaceholderPage title="Favorites" description="Saved sets." /></RequireAuth>} />
        <Route path="/progress" element={<RequireAuth><PlaceholderPage title="Progress" description="Your study statistics." /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><PlaceholderPage title="Profile" description="Your public profile." /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><PlaceholderPage title="Settings" description="Account settings." /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><PlaceholderPage title="Admin" description="Moderation." /></RequireAuth>} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
