import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { studyPackService } from '../../services/studyPackService';
import { subjectService } from '../../services/subjectService';
import type { StudyPackSummary } from '../../types';
import { StudyPacksPage } from './StudyPacksPage';

vi.mock('../../services/studyPackService', () => ({
  studyPackService: { list: vi.fn(), create: vi.fn() },
}));

vi.mock('../../services/subjectService', () => ({
  subjectService: { list: vi.fn(), create: vi.fn() },
}));

const listMock = vi.mocked(studyPackService.list);
const createMock = vi.mocked(studyPackService.create);
const subjectsMock = vi.mocked(subjectService.list);

const PACK: StudyPackSummary = {
  id: 'pack-1',
  ownerId: 'user-1',
  subjectId: null,
  subjectName: 'Biologie',
  title: 'Biologie H3',
  description: '',
  level: 'HAVO',
  visibility: 'private',
  examDate: '2026-10-18',
  examDaysLeft: 21,
  legacySetId: 'set-1',
  sources: 1,
  flashcards: 12,
  concepts: 4,
  practiceQuestions: 8,
  masteryPercent: 62,
  weakConcepts: 2,
  learningConcepts: 1,
  masteredConcepts: 1,
  dueCards: 4,
  lastStudiedAt: '2026-09-25T10:00:00.000Z',
  cardsReviewed: 6,
  practiceAnswers: 8,
  testsCompleted: 1,
  summaryUpdatedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
};

function renderPage() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <StudyPacksPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('StudyPacksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([PACK]);
    subjectsMock.mockResolvedValue([]);
  });

  it('lists packs with the numbers that matter', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Biologie H3' })).toBeInTheDocument();
    expect(screen.getByText(/1 source · 12 cards · 4 concepts · 8 questions/)).toBeInTheDocument();
    expect(screen.getByText('4 due')).toBeInTheDocument();
    expect(screen.getByText('2 weak concepts')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /continue studying/i }).length).toBeGreaterThan(0);
  });

  it('creates an empty pack and refreshes the list', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce([]).mockResolvedValue([PACK]);
    createMock.mockResolvedValue({ id: 'pack-1' } as never);

    renderPage();
    await user.click(await screen.findByRole('button', { name: /new pack/i }));
    await user.type(screen.getByLabelText(/title/i), 'Wiskunde H2');
    await user.click(screen.getByRole('button', { name: /create pack/i }));

    expect(await screen.findByRole('heading', { name: 'Biologie H3' })).toBeInTheDocument();
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Wiskunde H2', level: '', examDate: null }),
    );
  });

  it('offers study material as the starting point when there are no packs', async () => {
    listMock.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Start your first Study Pack')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Upload your notes, import a PDF or paste text and Lerno will turn it into a complete learning system.',
      ),
    ).toBeInTheDocument();
    const actions = screen.getAllByRole('link', { name: /add study material/i });
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).toHaveAttribute('href', '/study-packs/new');
    }
  });
});
