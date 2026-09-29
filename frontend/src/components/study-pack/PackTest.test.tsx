import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studyPackService } from '../../services/studyPackService';
import { studySessionService } from '../../services/studySessionService';
import { preview, testModes } from '../../test-fixtures/study';
import type { StudyPackDetail } from '../../types';
import { ToastProvider } from '../ui/Toast';
import { PackTest } from './PackTest';

vi.mock('../../services/studySessionService', () => ({
  studySessionService: { preview: vi.fn(), start: vi.fn() },
}));
vi.mock('../../services/studyPackService', () => ({
  studyPackService: { generate: vi.fn(), applyContent: vi.fn() },
}));

const previewMock = vi.mocked(studySessionService.preview);
const generateMock = vi.mocked(studyPackService.generate);

function pack(overrides: Record<string, unknown> = {}): StudyPackDetail {
  return {
    id: 'pack-1',
    isOwner: true,
    counts: { practiceQuestions: 24, readySources: 1 },
    progress: { weakConcepts: [] },
    recentAttempts: [],
    ...overrides,
  } as unknown as StudyPackDetail;
}

function renderTest(detail: StudyPackDetail, mode?: 'quick10' | 'quick20' | 'exam') {
  render(
    <MemoryRouter>
      <ToastProvider>
        <PackTest pack={detail} mode={mode} onChanged={() => undefined} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue(
    preview({
      type: 'test',
      mode: 'quick10',
      title: 'Practice test · Biology',
      focus: { label: 'No hints or explanations until you finish', conceptId: null, conceptName: null },
      modes: testModes(),
    }),
  );
});

describe('PackTest', () => {
  it('is the pre-start screen of a test with three lengths', async () => {
    renderTest(pack());
    expect(await screen.findByRole('heading', { name: 'Practice Test' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Start test' })).toBeInTheDocument();
  });

  it('opens on the exam simulation when the link asks for it', async () => {
    renderTest(pack(), 'exam');
    expect(await screen.findByRole('radio', { name: /exam simulation/i })).toBeChecked();
  });

  it('keeps the list of previous attempts', async () => {
    renderTest(
      pack({
        recentAttempts: [
          { id: 'a1', testId: 't1', score: 7, total: 10, createdAt: '2026-09-20T10:00:00.000Z', packTitle: 'Biology' },
        ],
      }),
    );
    const list = (await screen.findByRole('heading', { name: 'Previous attempts' })).closest('section')!;
    expect(within(list).getByText('70%')).toBeInTheDocument();
    expect(within(list).getByText(/7\/10/)).toBeInTheDocument();
  });

  it('asks for practice questions first when there are none', () => {
    renderTest(pack({ counts: { practiceQuestions: 0, readySources: 1 } }));
    expect(screen.getByRole('heading', { name: 'Practice questions first' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate practice questions/i })).toBeInTheDocument();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('generates ten questions for review, like before', async () => {
    generateMock.mockResolvedValue({ target: 'practice', questions: [] });
    const user = userEvent.setup();
    renderTest(pack({ counts: { practiceQuestions: 0, readySources: 1 } }));
    await user.click(screen.getByRole('button', { name: /generate practice questions/i }));
    expect(generateMock).toHaveBeenCalledWith('pack-1', 'practice', { count: 10 });
  });
});
