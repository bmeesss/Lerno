import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studyPackService } from '../../services/studyPackService';
import { studySessionService } from '../../services/studySessionService';
import { preview } from '../../test-fixtures/study';
import type { StudyPackDetail } from '../../types';
import { ToastProvider } from '../ui/Toast';
import { PackPractice } from './PackPractice';

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
    counts: { practiceQuestions: 12, readySources: 1 },
    progress: { weakConcepts: [{ id: 'c1', name: 'Osmosis' }] },
    concepts: [],
    ...overrides,
  } as unknown as StudyPackDetail;
}

function renderPractice(detail: StudyPackDetail, props: { review?: boolean; focusConceptId?: string } = {}) {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <ToastProvider>
        <PackPractice pack={detail} onChanged={onChanged} {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue(preview());
});

describe('PackPractice', () => {
  it('is the pre-start screen of an adaptive practice session', async () => {
    renderPractice(pack());
    expect(await screen.findByRole('heading', { name: 'Practice Biology' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start practice/i })).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'practice', conceptId: undefined }));
    expect(screen.getByRole('link', { name: /take a test instead/i })).toHaveAttribute('href', '/?tab=test');
  });

  it('practises one concept when the link names it', async () => {
    renderPractice(pack(), { focusConceptId: 'c1' });
    await screen.findByRole('heading', { name: 'Practice Biology' });
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'practice', conceptId: 'c1' }));
  });

  it('starts a review of due concepts in review mode', async () => {
    previewMock.mockResolvedValue(
      preview({ type: 'review', title: 'Review Biology', focus: { label: 'Focus: concepts due for review', conceptId: null, conceptName: null } }),
    );
    renderPractice(pack(), { review: true });
    expect(await screen.findByRole('heading', { name: 'Review Biology' })).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'review' }));
    expect(screen.getByRole('button', { name: /start review/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate more questions/i })).not.toBeInTheDocument();
  });

  it('offers to generate questions when the pack has none, and never starts a session', async () => {
    renderPractice(pack({ counts: { practiceQuestions: 0, readySources: 1 } }));
    expect(screen.getByRole('heading', { name: 'No practice questions yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate practice questions/i })).toBeEnabled();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('lets only the owner generate, and needs a readable source first', () => {
    renderPractice(pack({ isOwner: false, counts: { practiceQuestions: 0, readySources: 1 } }));
    expect(screen.queryByRole('button', { name: /generate practice questions/i })).not.toBeInTheDocument();
  });

  it('shows generated questions for review before anything is saved', async () => {
    generateMock.mockResolvedValue({
      target: 'practice',
      questions: [
        {
          questionType: 'multiple_choice',
          prompt: 'What is osmosis?',
          correctAnswer: 'Diffusion of water',
          options: ['Diffusion of water', 'Movement of salt'],
          explanation: 'Water moves across a membrane.',
          sourceId: 'source-1',
        },
      ],
    });
    const user = userEvent.setup();
    renderPractice(pack({ counts: { practiceQuestions: 0, readySources: 1 } }));
    await user.click(screen.getByRole('button', { name: /generate practice questions/i }));

    expect(generateMock).toHaveBeenCalledWith('pack-1', 'practice', { count: 8 });
    expect(await screen.findByRole('button', { name: /add 1 to pack/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('heading', { name: 'No practice questions yet' })).toBeInTheDocument();
  });
});
