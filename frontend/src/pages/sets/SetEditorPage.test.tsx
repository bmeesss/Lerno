import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type { StudySetDetail } from '../../types';
import { SetEditorPage } from './SetEditorPage';

vi.mock('../../services/studySetService', () => ({
  studySetService: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    addCards: vi.fn(),
    updateCard: vi.fn(),
    removeCard: vi.fn(),
  },
}));

vi.mock('../../services/subjectService', () => ({
  subjectService: { list: vi.fn() },
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useNavigate: () => mockNavigate };
});

const getMock = vi.mocked(studySetService.get);
const createMock = vi.mocked(studySetService.create);
const updateMock = vi.mocked(studySetService.update);
const addCardsMock = vi.mocked(studySetService.addCards);
const updateCardMock = vi.mocked(studySetService.updateCard);
const removeCardMock = vi.mocked(studySetService.removeCard);
const subjectsMock = vi.mocked(subjectService.list);

const DETAIL: StudySetDetail = {
  id: 'set-1',
  ownerId: 'u1',
  subjectId: null,
  subjectName: null,
  title: 'Biology',
  slug: 'biology-x',
  description: 'Cells',
  level: 'havo 4',
  visibility: 'private',
  tags: ['bio'],
  cardCount: 2,
  authorName: 'Student',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isOwner: true,
  favorited: false,
  cards: [
    { id: 'card-1', question: 'Q1?', answer: 'A1', position: 0 },
    { id: 'card-2', question: 'Q2?', answer: 'A2', position: 1 },
  ],
};

function renderCreate() {
  render(
    <MemoryRouter initialEntries={['/sets/new']}>
      <ToastProvider>
        <Routes>
          <Route path="/sets/new" element={<SetEditorPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function renderEdit() {
  render(
    <MemoryRouter initialEntries={['/sets/set-1/edit']}>
      <ToastProvider>
        <Routes>
          <Route path="/sets/:setId/edit" element={<SetEditorPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  subjectsMock.mockResolvedValue([]);
  getMock.mockResolvedValue(DETAIL);
  createMock.mockResolvedValue({ ...DETAIL, id: 'set-9' });
  updateMock.mockResolvedValue(DETAIL);
  addCardsMock.mockResolvedValue([]);
  updateCardMock.mockResolvedValue(DETAIL.cards[0]!);
  removeCardMock.mockResolvedValue(undefined);
});

describe('SetEditorPage create mode', () => {
  it('requires at least one card before creating', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText('Title'), 'Empty set');
    await user.click(screen.getByRole('button', { name: /create set$/i }));
    expect(await screen.findByText(/at least one card/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('previews pasted cards and skipped lines before adding them', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole('button', { name: /paste \/ import/i }));
    const dialog = screen.getByRole('dialog', { name: /paste cards or import csv/i });
    await user.type(within(dialog).getByLabelText('Paste list'), 'Q1 | A1\nnot a card\nQ2 | A2');
    expect(await within(dialog).findByText(/2 cards ready/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 line skipped/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/line 2:/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /add 2 cards/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /paste cards or import csv/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('Q1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A2')).toBeInTheDocument();
  });

  it('creates the set with trimmed values and navigates to it', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText('Title'), '  Bio H1  ');
    await user.click(screen.getByRole('button', { name: /paste \/ import/i }));
    const dialog = screen.getByRole('dialog', { name: /paste cards or import csv/i });
    await user.type(within(dialog).getByLabelText('Paste list'), 'Q? | A');
    await user.click(await within(dialog).findByRole('button', { name: /add 1 card/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /paste cards or import csv/i }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /create set$/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Bio H1',
        visibility: 'private',
        cards: [{ question: 'Q?', answer: 'A' }],
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/sets/set-9');
  });

  it('stops at the 500-card cap with a friendly error', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText('Title'), 'Too big');
    const bulk = Array.from({ length: 501 }, (_, i) => `Q${i} | A${i}`).join('\n');
    await user.click(screen.getByRole('button', { name: /paste \/ import/i }));
    const dialog = screen.getByRole('dialog', { name: /paste cards or import csv/i });
    // Bulk text via change event: typing 500+ lines char-by-char is too slow.
    fireEvent.change(within(dialog).getByLabelText('Paste list'), { target: { value: bulk } });
    await user.click(await within(dialog).findByRole('button', { name: /add 501 cards/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /paste cards or import csv/i }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /create set$/i }));
    expect(await screen.findByText(/at most 500 cards/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  }, 15_000); // Rendering 501 cards is slower on loaded CI workers.

  it('guards Cancel with a discard dialog only when dirty', async () => {
    const user = userEvent.setup();
    renderCreate();
    // Pristine: navigates straight away.
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/sets');
    expect(
      screen.queryByRole('dialog', { name: /discard unsaved changes/i }),
    ).not.toBeInTheDocument();

    // Dirty: asks first, then discards.
    await user.type(screen.getByLabelText('Title'), 'Draft');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    const dialog = await screen.findByRole('dialog', { name: /discard unsaved changes/i });
    await user.click(within(dialog).getByRole('button', { name: /keep editing/i }));
    expect(
      screen.queryByRole('dialog', { name: /discard unsaved changes/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    const dialog2 = await screen.findByRole('dialog', { name: /discard unsaved changes/i });
    await user.click(within(dialog2).getByRole('button', { name: /discard changes/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/sets');
  });
});

describe('SetEditorPage edit mode', () => {
  it('saves meta, batched new cards, edits and removals', async () => {
    const user = userEvent.setup();
    renderEdit();
    expect(await screen.findByDisplayValue('Biology')).toBeInTheDocument();

    // Edit title + one existing card, remove the other, paste two new cards.
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Biology 2');
    const answerBox = screen.getByDisplayValue('A1');
    await user.clear(answerBox);
    await user.type(answerBox, 'A1 edited');
    const removeButtons = screen.getAllByRole('button', { name: 'Remove card' });
    await user.click(removeButtons[1]!);
    await user.click(screen.getByRole('button', { name: /paste \/ import/i }));
    const dialog = screen.getByRole('dialog', { name: /paste cards or import csv/i });
    await user.type(within(dialog).getByLabelText('Paste list'), 'QN1 | AN1\nQN2 | AN2');
    await user.click(await within(dialog).findByRole('button', { name: /add 2 cards/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /paste cards or import csv/i }),
      ).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(
      'set-1',
      expect.objectContaining({ title: 'Biology 2' }),
    );
    expect(removeCardMock).toHaveBeenCalledTimes(1);
    expect(removeCardMock).toHaveBeenCalledWith('set-1', 'card-2');
    // Both new cards go in a single bulk call.
    expect(addCardsMock).toHaveBeenCalledTimes(1);
    expect(addCardsMock).toHaveBeenCalledWith('set-1', [
      { question: 'QN1', answer: 'AN1' },
      { question: 'QN2', answer: 'AN2' },
    ]);
    expect(updateCardMock).toHaveBeenCalledTimes(1);
    expect(updateCardMock).toHaveBeenCalledWith('set-1', 'card-1', {
      question: 'Q1?',
      answer: 'A1 edited',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/sets/set-1');
  });
});
