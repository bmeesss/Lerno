import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { studyPackService } from '../../services/studyPackService';
import type { AdaptiveLearnConcept, StudyPackDetail } from '../../types';
import { PackLearn } from './PackLearn';

vi.mock('../../services/studyPackService', () => ({
  studyPackService: { nextLearnConcept: vi.fn(), rateConcept: vi.fn() },
}));

const nextMock = vi.mocked(studyPackService.nextLearnConcept);
const rateMock = vi.mocked(studyPackService.rateConcept);

function concept(id: string, name: string): AdaptiveLearnConcept {
  return {
    id,
    name,
    explanation: `${name} explanation`,
    position: 0,
    masteryPercent: 20,
    confidencePercent: 55,
    attempts: 1,
    lastPracticedAt: null,
    cardCount: 2,
    questionCount: 3,
  };
}

const PACK = {
  id: 'pack-1',
  concepts: [
    { id: 'concept-1', name: 'Osmosis', attempts: 1, masteryPercent: 20, position: 0 },
    { id: 'concept-2', name: 'Cell membrane', attempts: 0, masteryPercent: 0, position: 1 },
  ],
} as StudyPackDetail;

function renderLearn() {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <ToastProvider>
        <PackLearn pack={PACK} onChanged={onChanged} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PackLearn adaptive session', () => {
  it('loads the first concept and asks the server for a newly ranked next concept after rating', async () => {
    nextMock
      .mockResolvedValueOnce({ concept: concept('concept-1', 'Osmosis'), remaining: 2, reason: 'weak' })
      .mockResolvedValueOnce({ concept: concept('concept-2', 'Cell membrane'), remaining: 1, reason: 'new' });
    rateMock.mockResolvedValue({
      conceptId: 'concept-1',
      masteryPercent: 40,
      attempts: 2,
      weak: false,
    });
    const user = userEvent.setup();
    renderLearn();

    await user.click(screen.getByRole('button', { name: /start learning/i }));
    expect(await screen.findByRole('heading', { name: 'Osmosis' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /got it/i }));

    expect(await screen.findByRole('heading', { name: 'Cell membrane' })).toBeInTheDocument();
    expect(rateMock).toHaveBeenCalledWith('pack-1', 'concept-1', 'good', expect.any(Number));
    expect(nextMock).toHaveBeenLastCalledWith('pack-1', ['concept-1'], undefined);
  });

  it('shows a session summary with mastery change and a concept-specific practice CTA', async () => {
    nextMock
      .mockResolvedValueOnce({ concept: concept('concept-1', 'Osmosis'), remaining: 1, reason: 'weak' })
      .mockResolvedValueOnce({ concept: null, remaining: 0, reason: null });
    rateMock.mockResolvedValue({
      conceptId: 'concept-1',
      masteryPercent: 25,
      attempts: 2,
      weak: true,
    });
    const user = userEvent.setup();
    renderLearn();

    await user.click(screen.getByRole('button', { name: /start learning/i }));
    await screen.findByRole('heading', { name: 'Osmosis' });
    await user.click(screen.getByRole('button', { name: /still learning/i }));

    expect(await screen.findByRole('heading', { name: /you reviewed 1 concept/i })).toBeInTheDocument();
    expect(screen.getByText(/20% → 25% mastery/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /practice osmosis/i })).toHaveAttribute(
      'href',
      '/?tab=practice&concept=concept-1',
    );
  });

  it('renders an honest empty state when a pack has no concepts', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <PackLearn pack={{ ...PACK, concepts: [] }} onChanged={() => undefined} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Nothing to learn yet' })).toBeInTheDocument();
  });

  it('shows loading while the adaptive queue is being chosen', async () => {
    let resolve!: (value: { concept: AdaptiveLearnConcept; remaining: number; reason: 'new' }) => void;
    nextMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    renderLearn();
    await user.click(screen.getByRole('button', { name: /start learning/i }));
    expect(screen.getByRole('heading', { name: /choosing your next concept/i })).toBeInTheDocument();
    resolve({ concept: concept('concept-2', 'Cell membrane'), remaining: 2, reason: 'new' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cell membrane' })).toBeInTheDocument());
  });
});
