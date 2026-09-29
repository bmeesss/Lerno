import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { ApiError } from '../../lib/api';
import { studyPackService, type ApplyContentResult } from '../../services/studyPackService';
import type { GenerationSettings, StudyContentPreview, StudyPackSource } from '../../types';
import { ContentReview } from './ContentReview';

vi.mock('../../services/studyPackService', () => ({
  studyPackService: {
    applyContent: vi.fn(),
    regenerateItem: vi.fn(),
  },
}));

const applyMock = vi.mocked(studyPackService.applyContent);
const regenerateMock = vi.mocked(studyPackService.regenerateItem);

const SETTINGS: GenerationSettings = {
  flashcards: 20,
  practice: 10,
  difficulty: 'medium',
  language: 'nl',
};

/** Two real sources: every item below points at exactly the place it came from. */
const SOURCE_A: StudyPackSource = {
  id: 'source-a',
  packId: 'pack-1',
  kind: 'pdf',
  title: 'Biologie H3.pdf',
  status: 'ready',
  characterCount: 12_000,
  pageCount: 14,
  failureReason: null,
  legacySetId: null,
  origin: 'imported',
  language: 'nl',
  stage: null,
  extractedBy: 'pdf-text',
  slideCount: null,
  durationSeconds: null,
  channel: null,
  url: null,
  warnings: [],
  references: [{ marker: 'p6', kind: 'page', label: 'page 6' }],
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:05:00.000Z',
};

const SOURCE_B: StudyPackSource = {
  ...SOURCE_A,
  id: 'source-b',
  kind: 'pdf',
  title: 'Lesnotities.pdf',
  characterCount: 4_000,
  pageCount: 3,
  extractedBy: 'pdf-text',
  references: [{ marker: 'p2', kind: 'page', label: 'page 2' }],
};

const PREVIEW: StudyContentPreview = {
  packId: 'pack-1',
  settings: SETTINGS,
  summary: {
    title: 'Celdeling',
    summary: 'Cellen delen zich door mitose. De celkern bevat het DNA en regelt de celdeling.',
    keyPoints: ['Mitose deelt de celkern', 'DNA zit in de celkern'],
    sourceId: 'source-a',
  },
  concepts: [
    {
      name: 'Mitose',
      explanation: 'Mitose is de deling van de celkern.',
      sourceId: 'source-a',
      refLabel: 'page 6',
      importance: 0.9,
      difficulty: 'medium',
    },
    {
      name: 'Celdeling',
      explanation: 'Celdeling is hoe een cel zich splitst in twee nieuwe cellen.',
      sourceId: 'source-b',
      refLabel: 'page 2',
      importance: 0.7,
      difficulty: 'hard',
    },
    {
      name: 'Celkern',
      explanation: 'De celkern bevat het DNA en komt in beide bronnen terug.',
      sourceId: 'source-a',
      refLabel: 'page 12',
      importance: 0.8,
      difficulty: 'easy',
    },
  ],
  flashcards: [
    {
      front: 'Wat is mitose?',
      back: 'De deling van de celkern.',
      refLabel: 'page 6',
      sourceId: 'source-a',
      conceptId: 'concept-1',
    },
    {
      front: 'Wat is celdeling?',
      back: 'Het splitsen van een cel in twee nieuwe cellen.',
      refLabel: 'page 2',
      sourceId: 'source-b',
      conceptId: 'concept-2',
    },
  ],
  questions: [
    {
      questionType: 'multiple_choice',
      prompt: 'Wat doet de celkern?',
      correctAnswer: 'Het regelt de celdeling',
      options: ['Het regelt de celdeling', 'Het maakt celwand', 'Het maakt eiwitten vrij'],
      explanation: 'De celkern bevat het DNA en stuurt de cel aan.',
      sourceId: 'source-a',
      refLabel: 'section "Celdeling"',
      conceptId: 'concept-1',
    },
    {
      questionType: 'short_answer',
      prompt: 'Leg uit wat mitose is.',
      correctAnswer: 'De deling van de celkern',
      options: null,
      explanation: 'Mitose splitst de celkern in twee kernen.',
      sourceId: 'source-b',
      refLabel: 'page 2',
      conceptId: 'concept-2',
    },
  ],
  rejected: [
    { kind: 'flashcard', index: 2, reason: 'duplicate_flashcard', detail: 'A duplicate flashcard was skipped.' },
    { kind: 'question', index: 3, reason: 'invalid_options', detail: 'A multiple-choice question had too few options.' },
  ],
  analysis: null,
  conflicts: [
    {
      topic: 'Aantal chromosomen',
      explanation: 'De bronnen noemen verschillende aantallen.',
      claims: [
        {
          sourceId: 'source-a',
          marker: 'p6',
          referenceLabel: 'page 6',
          statement: 'De cel heeft 46 chromosomen.',
          quote: 'een menselijke cel heeft 46 chromosomen',
        },
        {
          sourceId: 'source-b',
          marker: 'p2',
          referenceLabel: 'page 2',
          statement: 'De cel heeft 23 chromosomen.',
          quote: 'de cel bevat 23 chromosomen',
        },
      ],
    },
  ],
};

function renderReview(preview: StudyContentPreview = PREVIEW) {
  const onApplied = vi.fn();
  const onDiscard = vi.fn();
  render(
    <ToastProvider>
      <ContentReview
        packId="pack-1"
        preview={preview}
        sources={[SOURCE_A, SOURCE_B]}
        settings={preview.settings}
        onApplied={onApplied}
        onDiscard={onDiscard}
      />
    </ToastProvider>,
  );
  return { onApplied, onDiscard };
}

describe('ContentReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyMock.mockImplementation(async (_packId, input): Promise<ApplyContentResult> => {
      switch (input.target) {
        case 'summary':
          return { summary: input.summary ?? null, summarySourceId: input.sourceId ?? null };
        case 'concepts':
          return { added: input.concepts?.length ?? 0, skipped: 0, concepts: [] };
        case 'flashcards':
          return { added: input.cards?.length ?? 0, cards: [] };
        default:
          return { added: input.questions?.length ?? 0, questions: [] };
      }
    });
  });

  it('shows summary, concepts, flashcards and practice counts', () => {
    renderReview();

    expect(screen.getByRole('heading', { name: 'Review everything Lerno generated' })).toBeInTheDocument();
    expect(screen.getByText('AI preview · nothing saved yet')).toBeInTheDocument();

    const summaryTab = screen.getByRole('tab', { name: /Summary/ });
    expect(summaryTab).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tab', { name: /Concepts/ })).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /Flashcards/ })).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /Practice/ })).getByText('2')).toBeInTheDocument();

    expect(screen.getByLabelText('Summary')).toHaveValue(PREVIEW.summary!.summary);
  });

  it('switches between tabs and shows the items of each kind', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole('tab', { name: /Concepts/ }));
    expect(screen.getByLabelText('Concept 1 name')).toHaveValue('Mitose');
    expect(screen.getByLabelText('Concept 3 explanation')).toHaveValue(
      'De celkern bevat het DNA en komt in beide bronnen terug.',
    );

    await user.click(screen.getByRole('tab', { name: /Flashcards/ }));
    expect(screen.getByLabelText('Flashcard 1 front')).toHaveValue('Wat is mitose?');
    expect(screen.getByLabelText('Flashcard 1 back')).toHaveValue('De deling van de celkern.');

    await user.click(screen.getByRole('tab', { name: /Practice/ }));
    expect(screen.getByLabelText('Question 1 prompt')).toHaveValue('Wat doet de celkern?');
    expect(screen.getByLabelText('Question 2 answer')).toHaveValue('De deling van de celkern');
  });

  it('keeps an edited item as the student typed it until it is accepted', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole('tab', { name: /Concepts/ }));
    const name = screen.getByLabelText('Concept 1 name');
    await user.clear(name);
    await user.type(name, 'Mitose (kern)deling');
    expect(name).toHaveValue('Mitose (kern)deling');

    // Nothing is stored while editing: the review screen is still the only copy.
    expect(applyMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Accept/ }));

    await waitFor(() => expect(applyMock).toHaveBeenCalled());
    const concepts = applyMock.mock.calls.find(([, input]) => input.target === 'concepts')?.[1];
    expect(concepts).toMatchObject({
      target: 'concepts',
      concepts: expect.arrayContaining([
        expect.objectContaining({ name: 'Mitose (kern)deling' }),
      ]),
    });
  });

  it('discards the whole review without saving anything', async () => {
    const user = userEvent.setup();
    const { onDiscard } = renderReview();

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('leaves a deleted item out of what is saved', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole('tab', { name: /Flashcards/ }));
    await user.click(screen.getByRole('button', { name: 'Remove flashcard 1' }));

    // The row stays visible (marked as dropped) so the student can undo it.
    expect(screen.getByLabelText('Flashcard 1 front')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accept 7 items/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Accept/ }));

    await waitFor(() => expect(applyMock).toHaveBeenCalled());
    const cards = applyMock.mock.calls.find(([, input]) => input.target === 'flashcards')?.[1];
    expect(cards).toMatchObject({
      target: 'flashcards',
      cards: [expect.objectContaining({ front: 'Wat is celdeling?' })],
    });
    // The rest of the review is saved untouched.
    expect(applyMock).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ target: 'summary' }),
    );
    const questions = applyMock.mock.calls.find(([, input]) => input.target === 'practice')?.[1];
    expect(questions).toMatchObject({ questions: expect.any(Array) });
  });

  it('accepts only the items of one tab when the others are dropped', async () => {
    const user = userEvent.setup();
    renderReview();

    await user.click(screen.getByRole('button', { name: 'Drop summary' }));
    for (let index = 1; index <= 3; index += 1) {
      await user.click(screen.getByRole('tab', { name: /Concepts/ }));
      await user.click(screen.getByRole('button', { name: `Remove concept ${index}` }));
    }
    for (let index = 1; index <= 2; index += 1) {
      await user.click(screen.getByRole('tab', { name: /Flashcards/ }));
      await user.click(screen.getByRole('button', { name: `Remove flashcard ${index}` }));
    }

    expect(screen.getByRole('button', { name: /Accept 2 items/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Accept/ }));

    await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
    expect(applyMock).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ target: 'practice', questions: expect.any(Array) }),
    );
  });

  it('saves every kept item with its source, reference and concept intact', async () => {
    const user = userEvent.setup();
    const { onApplied } = renderReview();

    await user.click(screen.getByRole('button', { name: /Accept 8 items/ }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('8 items saved to your study pack'));

    expect(applyMock).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ target: 'summary', sourceId: 'source-a' }),
    );
    expect(applyMock).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({
        target: 'concepts',
        concepts: [
          expect.objectContaining({ name: 'Mitose', sourceId: 'source-a', refLabel: 'page 6' }),
          expect.objectContaining({ name: 'Celdeling', sourceId: 'source-b', refLabel: 'page 2' }),
          expect.objectContaining({ name: 'Celkern', sourceId: 'source-a', refLabel: 'page 12' }),
        ],
      }),
    );
    expect(applyMock).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({
        target: 'flashcards',
        cards: [
          expect.objectContaining({
            front: 'Wat is mitose?',
            sourceId: 'source-a',
            conceptId: 'concept-1',
          }),
          expect.objectContaining({
            front: 'Wat is celdeling?',
            sourceId: 'source-b',
            conceptId: 'concept-2',
          }),
        ],
      }),
    );
    expect(applyMock).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({
        target: 'practice',
        questions: [
          expect.objectContaining({
            prompt: 'Wat doet de celkern?',
            sourceId: 'source-a',
            conceptId: 'concept-1',
            options: expect.any(Array),
          }),
          expect.objectContaining({
            prompt: 'Leg uit wat mitose is.',
            sourceId: 'source-b',
            conceptId: 'concept-2',
            options: null,
          }),
        ],
      }),
    );
  });

  it('shows where every item came from, per source', async () => {
    const user = userEvent.setup();
    renderReview();

    // The summary belongs to the whole source, so it reads as the source itself.
    expect(screen.getByText('Source: Biologie H3.pdf')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Concepts/ }));
    expect(screen.getByText('Source: Biologie H3.pdf · page 6')).toBeInTheDocument();
    expect(screen.getByText('Source: Lesnotities.pdf · page 2')).toBeInTheDocument();
    expect(screen.getByText('Source: Biologie H3.pdf · page 12')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Flashcards/ }));
    expect(screen.getByText('Generated from: Biologie H3.pdf · page 6')).toBeInTheDocument();
    expect(screen.getByText('Generated from: Lesnotities.pdf · page 2')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Practice/ }));
    expect(screen.getByText('Based on: section "Celdeling"')).toBeInTheDocument();
    expect(screen.getByText('Based on: page 2')).toBeInTheDocument();
  });

  it('shows conflicts with both sources instead of merging them', async () => {
    const user = userEvent.setup();
    renderReview();

    expect(screen.getByText('Conflicting information found')).toBeInTheDocument();
    const claims = screen.getAllByText(/De cel heeft \d+ chromosomen\./);
    expect(claims).toHaveLength(2);
    expect(screen.getByText('Biologie H3.pdf · page 6:')).toBeInTheDocument();
    expect(screen.getByText('Lesnotities.pdf · page 2:')).toBeInTheDocument();
    expect(screen.getByText(/46 chromosomen/)).toBeInTheDocument();
    expect(screen.getByText(/23 chromosomen/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Accept/ }));
    await waitFor(() => expect(applyMock).toHaveBeenCalled());
    // Both versions are still offered as separate content: nothing was deleted.
    expect(screen.getByText('Conflicting information found')).toBeInTheDocument();
  });

  it('explains rejected items and never shows them as content', () => {
    renderReview();

    expect(
      screen.getByText('2 items did not pass the quality check and were left out.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('A duplicate flashcard was skipped.')).not.toBeInTheDocument();
  });

  it('replaces exactly one item when it is regenerated', async () => {
    const user = userEvent.setup();
    regenerateMock.mockResolvedValue({
      kind: 'flashcard',
      item: {
        front: 'Wat gebeurt er tijdens mitose?',
        back: 'De celkern deelt zich in twee kernen.',
        refLabel: 'page 7',
        sourceId: 'source-a',
        conceptId: 'concept-1',
      },
    });
    renderReview();

    await user.click(screen.getByRole('tab', { name: /Flashcards/ }));
    await user.click(screen.getByRole('button', { name: 'Regenerate flashcard 1' }));

    await waitFor(() =>
      expect(regenerateMock).toHaveBeenCalledWith('pack-1', {
        kind: 'flashcard',
        current: expect.objectContaining({ front: 'Wat is mitose?' }),
        sourceId: 'source-a',
        settings: SETTINGS,
      }),
    );

    expect(await screen.findByDisplayValue('Wat gebeurt er tijdens mitose?')).toBeInTheDocument();
    // The second card is untouched, and nothing was written to the pack.
    expect(screen.getByDisplayValue('Wat is celdeling?')).toBeInTheDocument();
    expect(applyMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Regenerated — review the new version')).toBeInTheDocument();
  });

  it('shows a busy state while regenerating', async () => {
    const user = userEvent.setup();
    let finish: (value: {
      kind: 'concept';
      item: (typeof PREVIEW)['concepts'][number];
    }) => void = () => undefined;
    regenerateMock.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderReview();

    await user.click(screen.getByRole('tab', { name: /Concepts/ }));
    await user.click(screen.getByRole('button', { name: 'Regenerate concept 1' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Regenerate concept 1' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: /Accept/ })).toBeDisabled();

    finish({
      kind: 'concept',
      item: {
        name: 'Mitose',
        explanation: 'Mitose deelt de celkern in twee identieke kernen.',
        sourceId: 'source-a',
        refLabel: 'page 7',
        importance: 0.9,
        difficulty: 'medium',
      },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Regenerate concept 1' })).toBeEnabled(),
    );
    expect(await screen.findByText('Source: Biologie H3.pdf · page 7')).toBeInTheDocument();
  });

  it('keeps the original item and explains the failure when regeneration fails', async () => {
    const user = userEvent.setup();
    regenerateMock.mockRejectedValue(
      new ApiError('We could not generate a replacement right now.', 'AI_UNAVAILABLE', 503),
    );
    renderReview();

    await user.click(screen.getByRole('tab', { name: /Practice/ }));
    await user.click(screen.getByRole('button', { name: 'Regenerate question 1' }));

    expect(
      await screen.findByText('We could not generate a replacement right now.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Question 1 prompt')).toHaveValue('Wat doet de celkern?');
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('reports a failed save instead of pretending it worked', async () => {
    const user = userEvent.setup();
    applyMock.mockRejectedValue(
      new ApiError('This source is not part of this study pack.', 'NOT_FOUND', 404),
    );
    const { onApplied } = renderReview();

    await user.click(screen.getByRole('button', { name: /Accept/ }));

    expect(await screen.findByText('This source is not part of this study pack.')).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('works without a summary and with a single rejected-item note', async () => {
    const user = userEvent.setup();
    renderReview({
      ...PREVIEW,
      summary: null,
      rejected: [
        { kind: 'concept', index: 0, reason: 'duplicate_concept', detail: '"Mitose" already exists.' },
      ],
    });

    // Without a summary the review opens on the concepts that do exist.
    expect(screen.getByRole('tab', { name: /Concepts/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('1 item did not pass the quality check and was left out.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Accept 7 items/ }));
    await waitFor(() => expect(applyMock).toHaveBeenCalled());
    expect(applyMock).not.toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ target: 'summary' }),
    );
  });
});
