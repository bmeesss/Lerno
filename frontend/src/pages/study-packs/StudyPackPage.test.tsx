import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { studyPackService } from '../../services/studyPackService';
import { subjectService } from '../../services/subjectService';
import type { StudyPackDetail } from '../../types';
import { StudyPackPage } from './StudyPackPage';

vi.mock('../../services/studyPackService', () => ({
  studyPackService: {
    get: vi.fn(),
    generate: vi.fn(),
    applyContent: vi.fn(),
    createPlan: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    practiceQueue: vi.fn(),
    gradePractice: vi.fn(),
    createTest: vi.fn(),
    submitTest: vi.fn(),
    rateConcept: vi.fn(),
    tutor: vi.fn(),
  },
}));

vi.mock('../../services/subjectService', () => ({
  subjectService: { list: vi.fn(), create: vi.fn() },
}));

vi.mock('../../services/studySetService', () => ({
  studySetService: {
    get: vi.fn().mockResolvedValue({ id: 'set-1', cards: [] }),
    listMine: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/aiStudioService', () => ({
  aiStudioService: { extractPdf: vi.fn().mockResolvedValue({ title: 'x', text: 'y', pageCount: 1 }) },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', profile: { displayName: 'Sam' } } }),
}));

const getMock = vi.mocked(studyPackService.get);
const subjectsMock = vi.mocked(subjectService.list);

const PACK: StudyPackDetail = {
  id: 'pack-1',
  ownerId: 'user-1',
  isOwner: true,
  title: 'Biologie H3',
  description: 'Cellen en weefsels',
  subjectId: null,
  subjectName: 'Biologie',
  level: 'HAVO',
  visibility: 'private',
  examDate: '2026-10-18',
  examDaysLeft: 21,
  summary: 'Cellen zijn de bouwstenen van leven.',
  summarySourceId: 'source-1',
  summaryUpdatedAt: '2026-09-20T10:00:00.000Z',
  legacySetId: 'set-1',
  schoolMethod: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
  counts: {
    sources: 1,
    readySources: 1,
    flashcards: 12,
    concepts: 2,
    practiceQuestions: 5,
    tests: 1,
  },
  progress: {
    masteryPercent: 62,
    dueCards: 4,
    studiedCards: 8,
    totalCards: 12,
    practiceAnswers: 6,
    practiceAccuracy: 0.67,
    testAttempts: 1,
    bestTestScorePercent: 80,
    weakConcepts: [{ id: 'concept-2', name: 'Mitose' }],
    strongConcepts: [{ id: 'concept-1', name: 'Celkern' }],
    lastActivityAt: '2026-09-25T10:00:00.000Z',
  },
  recommended: {
    type: 'practice',
    label: 'Practise Mitose',
    description: 'You are weakest on this concept right now.',
    conceptId: 'concept-2',
    conceptName: 'Mitose',
  },
  sources: [
    {
      id: 'source-1',
      packId: 'pack-1',
      kind: 'pdf',
      title: 'Biologie H3.pdf',
      status: 'ready',
      characterCount: 4200,
      pageCount: 6,
      failureReason: null,
      legacySetId: null,
      origin: 'user',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
  ],
  concepts: [
    {
      id: 'concept-1',
      packId: 'pack-1',
      name: 'Celkern',
      explanation: 'Bevat het DNA.',
      sourceId: 'source-1',
      sourceTitle: 'Biologie H3.pdf',
      origin: 'ai',
      position: 0,
      masteryPercent: 84,
      attempts: 4,
      cardCount: 5,
      questionCount: 2,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'concept-2',
      packId: 'pack-1',
      name: 'Mitose',
      explanation: 'Celdeling.',
      sourceId: null,
      sourceTitle: null,
      origin: 'ai',
      position: 1,
      masteryPercent: 32,
      attempts: 2,
      cardCount: 3,
      questionCount: 3,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
  ],
  studyPlan: null,
  tests: [],
  recentAttempts: [],
};

/** A pack straight out of the import: material in, nothing studied yet. */
const FRESH: StudyPackDetail = {
  ...PACK,
  counts: { ...PACK.counts, tests: 0 },
  progress: {
    ...PACK.progress,
    masteryPercent: 0,
    dueCards: 0,
    studiedCards: 0,
    practiceAnswers: 0,
    testAttempts: 0,
    bestTestScorePercent: null,
    weakConcepts: [],
    strongConcepts: [],
  },
  recommended: {
    type: 'learn',
    label: 'Start learning Biologie H3',
    description: 'Learn the first concepts from your material.',
    conceptId: 'concept-1',
    conceptName: 'Celkern',
  },
};

function renderPage(path = '/study-packs/pack-1') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/study-packs/:packId" element={<StudyPackPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('StudyPackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue(PACK);
    subjectsMock.mockResolvedValue([]);
  });

  it('shows the pack as a learning environment, not a CRUD page', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Biologie H3' })).toBeInTheDocument();
    expect(screen.getAllByText('62%').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /continue studying/i })).toBeInTheDocument();
    expect(screen.getAllByText(/21 days left/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4 due/i).length).toBeGreaterThan(0);
  });

  it('recommends one clear next action and links to it', async () => {
    renderPage();

    expect(await screen.findByText('Practise Mitose')).toBeInTheDocument();
    const start = screen.getByRole('link', { name: /start now/i });
    expect(start).toHaveAttribute('href', '/study-packs/pack-1?tab=practice&concept=concept-2');
  });

  it('opens a tab from the query string and shows strong and weak concepts', async () => {
    renderPage('/study-packs/pack-1?tab=concepts');

    expect(await screen.findByRole('heading', { name: 'Concepts' })).toBeInTheDocument();
    expect(screen.getByText('Celkern')).toBeInTheDocument();
    expect(screen.getByText('Mitose')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /weak 1/i })).toBeInTheDocument();
  });

  it('lists sources with status and provenance', async () => {
    renderPage('/study-packs/pack-1?tab=sources');

    expect(await screen.findByRole('heading', { name: 'Sources' })).toBeInTheDocument();
    const row = screen.getByText('Biologie H3.pdf').closest('li')!;
    expect(within(row).getByText(/PDF · 6 pages/)).toBeInTheDocument();
  });

  it('shows an error state when the pack cannot be loaded', async () => {
    getMock.mockRejectedValue(new Error('Study pack not found'));
    renderPage();

    expect((await screen.findAllByText('Study pack not found')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /back to study packs/i })).toBeInTheDocument();
  });

  it('welcomes a freshly created pack with real counts and one clear start', async () => {
    getMock.mockResolvedValue(FRESH);
    renderPage();

    const welcome = await screen.findByText('Your Study Pack is ready');
    const panel = welcome.closest('section')!;
    expect(within(panel).getByRole('heading', { name: 'Biologie H3' })).toBeInTheDocument();
    expect(within(panel).getByText('6')).toBeInTheDocument();
    expect(within(panel).getByText('2')).toBeInTheDocument();
    expect(within(panel).getByText('12')).toBeInTheDocument();
    expect(within(panel).getByText('5')).toBeInTheDocument();

    const start = within(panel).getByRole('link', { name: /start learn/i });
    expect(start).toHaveAttribute('href', '/study-packs/pack-1?tab=learn&concept=concept-1');
    expect(within(panel).getByRole('link', { name: /review material/i })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=overview#pack-overview',
    );
    expect(within(panel).getByRole('link', { name: /view concepts/i })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=concepts',
    );
    expect(within(panel).getByRole('link', { name: /practice/i })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=practice',
    );
    expect(within(panel).getByRole('link', { name: /take a test/i })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=test',
    );
  });

  it('tells the student when AI is unavailable without blocking the pack', async () => {
    getMock.mockResolvedValue({ ...FRESH, aiAvailable: false });
    renderPage();

    expect(await screen.findByText('AI generation unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Your material is saved/)).toBeInTheDocument();
  });

  it('shows where generated content came from, traceable to its source', async () => {
    renderPage('/study-packs/pack-1?tab=concepts');

    const provenance = await screen.findByText(/Generated from:/);
    expect(provenance).toHaveTextContent('Biologie H3.pdf');
    expect(within(provenance).getByRole('link', { name: 'Biologie H3.pdf' })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=sources',
    );
  });

  it('keeps the progress tab honest without any activity', async () => {
    renderPage('/study-packs/pack-1?tab=progress');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument());
    expect(screen.getByText('Mastery per concept')).toBeInTheDocument();
    expect(screen.getByText('No tests taken yet.')).toBeInTheDocument();
  });
});
