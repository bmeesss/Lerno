import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import { subjectOverview } from '../../test-fixtures/study';
import type { StudySetSummary } from '../../types';
import { SubjectDetailPage } from './SubjectDetailPage';

vi.mock('../../services/subjectService', () => ({ subjectService: { overview: vi.fn() } }));
vi.mock('../../services/studySetService', () => ({ studySetService: { listMine: vi.fn() } }));

const overviewMock = vi.mocked(subjectService.overview);
const setsMock = vi.mocked(studySetService.listMine);

const SET = {
  id: 'set-1',
  subjectId: 'sub-1',
  title: 'Cell cards',
  description: 'The basics',
  level: 'HAVO',
  cardCount: 12,
} as unknown as StudySetSummary;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/subjects/sub-1']}>
      <Routes>
        <Route path="/subjects/:subjectId" element={<SubjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  overviewMock.mockResolvedValue(subjectOverview());
  setsMock.mockResolvedValue([
    SET,
    { ...SET, id: 'set-2', subjectId: 'other', title: 'Other subject' },
  ]);
});

describe('SubjectDetailPage', () => {
  it('loads everything in one overview request', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Biology' });
    expect(overviewMock).toHaveBeenCalledTimes(1);
    expect(overviewMock).toHaveBeenCalledWith('sub-1');
  });

  it('shows where the student stands: mastery, due work, weak concepts and exams', async () => {
    renderPage();
    const summary = (await screen.findByRole('heading', { name: 'Where you stand' })).closest(
      'section',
    )!;
    const fact = (label: string) => within(summary).getByText(label).nextElementSibling!;
    expect(fact('Mastery')).toHaveTextContent('62%');
    expect(fact('Due')).toHaveTextContent('12 cards');
    expect(fact('Weak concepts')).toHaveTextContent('4');
    expect(fact('Exams')).toHaveTextContent('1');
    expect(screen.getByText(/2 study packs · 12 concepts · 1 set/)).toBeInTheDocument();
  });

  it('has one clear call to action: continue studying, with the reason', async () => {
    const { container } = renderPage();
    const cta = await screen.findByRole('link', { name: /continue studying/i });
    expect(cta).toHaveAttribute('href', '/study-packs/pack-1?tab=practice&concept=c2');
    expect(cta).toHaveClass('btn-primary');
    expect(container.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(screen.getByText('Practice Diffusion.')).toBeInTheDocument();
    expect(screen.getByText('You missed 3 recent questions.')).toBeInTheDocument();
  });

  it('lists each pack with mastery, due cards, last activity and its exam', async () => {
    renderPage();
    const list = (await screen.findByRole('heading', { name: 'Study packs' })).closest('section')!;
    const [first, second] = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.classList.contains('subject-pack'));

    expect(within(first!).getByRole('link', { name: 'Biology H3' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1',
    );
    expect(within(first!).getByText('70%')).toBeInTheDocument();
    expect(within(first!).getByText('8 due')).toBeInTheDocument();
    expect(within(first!).getByText('Exam in 9 days')).toBeInTheDocument();
    expect(within(first!).getByText(/Last studied/)).toBeInTheDocument();
    expect(
      within(first!).getByRole('link', { name: 'Start practice: Biology H3' }),
    ).toBeInTheDocument();

    expect(within(second!).getByText(/Not studied yet/)).toBeInTheDocument();
  });

  it('lets the student practise a weak concept straight from the pack', async () => {
    renderPage();
    const link = await screen.findAllByRole('link', { name: 'Practice Diffusion (18%)' });
    expect(link[0]).toHaveAttribute('href', '/study-packs/pack-1?tab=practice&concept=c2');
  });

  it('offers to resume an open session in a pack, with where it stopped', async () => {
    renderPage();
    const resume = await screen.findByRole('link', {
      name: /Continue Biology Practice, Question 6 of 10/,
    });
    expect(resume).toHaveAttribute('href', '/study/sessions/s9');
  });

  it('shows the nearest exam and the exams list with real countdowns', async () => {
    renderPage();
    const banner = await screen.findByRole('region', { name: 'Upcoming exam' });
    expect(within(banner).getByText('Biology H3 — Exam in 9 days')).toBeInTheDocument();
    const exams = screen.getByRole('heading', { name: 'Exams' }).closest('section')!;
    expect(within(exams).getByRole('link', { name: 'Biology H3' })).toBeInTheDocument();
    expect(within(exams).getByText(/Exam in 9 days/)).toBeInTheDocument();
  });

  it('shows recent activity from finished sessions', async () => {
    renderPage();
    const activity = (await screen.findByRole('heading', { name: 'Recent activity' })).closest(
      'section',
    )!;
    expect(within(activity).getByRole('link', { name: 'Biology Practice' })).toHaveAttribute(
      'href',
      '/study/sessions/s7',
    );
    expect(within(activity).getByText('80%')).toBeInTheDocument();
    expect(within(activity).getByText(/10 answered/)).toBeInTheDocument();
  });

  it('says there is no activity yet instead of leaving a gap', async () => {
    overviewMock.mockResolvedValue(subjectOverview({ recentActivity: [] }));
    renderPage();
    expect(await screen.findByText(/No finished sessions yet/)).toBeInTheDocument();
  });

  it('still lists the flashcard sets of this subject, and only this subject', async () => {
    renderPage();
    const sets = (await screen.findByRole('heading', { name: 'Study sets' })).closest('section')!;
    expect(within(sets).getByRole('link', { name: /Cell cards/ })).toHaveAttribute(
      'href',
      '/sets/set-1',
    );
    expect(within(sets).queryByText('Other subject')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create set in Biology' })).toHaveAttribute(
      'href',
      '/sets/new?subjectId=sub-1',
    );
  });

  it('shows an honest empty state for a subject without material', async () => {
    overviewMock.mockResolvedValue(
      subjectOverview({
        totals: { packs: 0, concepts: 0, masteryPercent: null, dueCards: 0, weakConcepts: 0 },
        packs: [],
        exams: [],
        recentActivity: [],
        next: null,
      }),
    );
    setsMock.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Nothing in this subject yet' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add study material/i })).toHaveAttribute(
      'href',
      '/study-packs/new',
    );
    expect(screen.queryByRole('heading', { name: 'Where you stand' })).not.toBeInTheDocument();
  });

  it('does not claim a mastery percentage that does not exist yet', async () => {
    overviewMock.mockResolvedValue(
      subjectOverview({
        totals: { packs: 1, concepts: 3, masteryPercent: null, dueCards: 0, weakConcepts: 0 },
        next: null,
      }),
    );
    renderPage();
    const summary = (await screen.findByRole('heading', { name: 'Where you stand' })).closest(
      'section',
    )!;
    expect(within(summary).getByText('Mastery').nextElementSibling).toHaveTextContent(
      'Not started',
    );
    expect(
      within(summary).getByText('Nothing needs your attention right now.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /continue studying/i })).not.toBeInTheDocument();
  });

  it('answers "not found" for a subject that is not the student’s', async () => {
    overviewMock.mockRejectedValue(new ApiError('Subject not found', 'not_found', 404));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Subject not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to My Study' })).toHaveAttribute(
      'href',
      '/study',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers a retry for any other failure', async () => {
    overviewMock.mockRejectedValueOnce(new Error('Server down'));
    const user = userEvent.setup();
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Could not load this subject' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument();
  });

  it('keeps the overview when the flashcard sets cannot be loaded', async () => {
    setsMock.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Biology' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Study sets' })).not.toBeInTheDocument();
  });
});
