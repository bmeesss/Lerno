import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studySessionService } from '../../services/studySessionService';
import { preview } from '../../test-fixtures/study';
import type { StudyPackDetail } from '../../types';
import { PackLearn } from './PackLearn';

vi.mock('../../services/studySessionService', () => ({
  studySessionService: { preview: vi.fn(), start: vi.fn() },
}));

const previewMock = vi.mocked(studySessionService.preview);

const PACK = {
  id: 'pack-1',
  concepts: [
    { id: 'concept-1', name: 'Osmosis', attempts: 1, masteryPercent: 20, position: 0 },
    { id: 'concept-2', name: 'Cell membrane', attempts: 0, masteryPercent: 0, position: 1 },
  ],
  progress: { weakConcepts: [{ id: 'concept-1', name: 'Osmosis' }] },
} as unknown as StudyPackDetail;

function renderLearn(pack: StudyPackDetail = PACK, focusConceptId?: string) {
  render(
    <MemoryRouter>
      <PackLearn pack={pack} focusConceptId={focusConceptId} onChanged={() => undefined} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue(
    preview({
      type: 'learn',
      title: 'Learn Biology',
      count: 2,
      minutes: 4,
      focus: { label: 'Focus: weak and new concepts', conceptId: null, conceptName: null },
      concepts: [
        { id: 'concept-1', name: 'Osmosis', masteryPercent: 20, reason: 'weak' },
        { id: 'concept-2', name: 'Cell membrane', masteryPercent: 0, reason: 'new' },
      ],
    }),
  );
});

describe('PackLearn', () => {
  it('is the pre-start screen of an adaptive learn session: weak first, then new', async () => {
    renderLearn();

    expect(await screen.findByRole('heading', { name: 'Learn Biology' })).toBeInTheDocument();
    expect(screen.getByText('2 concepts')).toBeInTheDocument();
    expect(screen.getByText('Focus: weak and new concepts')).toBeInTheDocument();
    expect(screen.getByText('Weak')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start learning/i })).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith({
      packId: 'pack-1',
      type: 'learn',
      mode: undefined,
      conceptId: undefined,
    });
  });

  it('keeps flashcards one click away', async () => {
    renderLearn();
    expect(await screen.findByRole('link', { name: /study flashcards instead/i })).toHaveAttribute(
      'href',
      '/?tab=flashcards',
    );
  });

  it('learns one specific concept when the link names it', async () => {
    renderLearn(PACK, 'concept-2');
    await screen.findByRole('heading', { name: 'Learn Biology' });
    expect(previewMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'learn', conceptId: 'concept-2' }),
    );
  });

  it('renders an honest empty state when a pack has no concepts', () => {
    renderLearn({ ...PACK, concepts: [] } as StudyPackDetail);
    expect(screen.getByRole('heading', { name: 'Nothing to learn yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open concepts' })).toHaveAttribute(
      'href',
      '/?tab=concepts',
    );
    expect(previewMock).not.toHaveBeenCalled();
  });
});
