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
import { ProgressPage } from './pages/ProgressPage';
import { ReviewPage } from './pages/ReviewPage';
import { MySetsPage } from './pages/sets/MySetsPage';
import { SetDetailPage } from './pages/sets/SetDetailPage';
import { SetEditorPage } from './pages/sets/SetEditorPage';
import { PracticePage } from './pages/study/PracticePage';
import { StudyPage } from './pages/study/StudyPage';
import { SubjectDetailPage } from './pages/subjects/SubjectDetailPage';
import { SubjectsPage } from './pages/subjects/SubjectsPage';

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
        <Route path="/sets/:setId" element={<SetDetailPage />} />
        <Route path="/sets/:setId/study" element={<StudyPage />} />
        <Route path="/sets/:setId/practice" element={<PracticePage />} />
        <Route path="/sets/:setId/quiz" element={<PlaceholderPage title="Quiz" description="Quiz mode." />} />

        {/* Authenticated */}
        <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
        <Route path="/subjects" element={<RequireAuth><SubjectsPage /></RequireAuth>} />
        <Route path="/subjects/:subjectId" element={<RequireAuth><SubjectDetailPage /></RequireAuth>} />
        <Route path="/sets" element={<RequireAuth><MySetsPage /></RequireAuth>} />
        <Route path="/sets/new" element={<RequireAuth><SetEditorPage /></RequireAuth>} />
        <Route path="/sets/:setId/edit" element={<RequireAuth><SetEditorPage /></RequireAuth>} />
        <Route path="/review" element={<RequireAuth><ReviewPage /></RequireAuth>} />
        <Route path="/favorites" element={<RequireAuth><PlaceholderPage title="Favorites" description="Saved sets." /></RequireAuth>} />
        <Route path="/progress" element={<RequireAuth><ProgressPage /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><PlaceholderPage title="Profile" description="Your public profile." /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><PlaceholderPage title="Settings" description="Account settings." /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><PlaceholderPage title="Admin" description="Moderation." /></RequireAuth>} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
