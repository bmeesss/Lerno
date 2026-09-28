import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIStudioPage } from './AIStudioPage';
import { aiStudioService } from '../../services/aiStudioService';
import { studySetService } from '../../services/studySetService';

vi.mock('../../services/aiStudioService', () => ({
  toStudioActionSource: (current: { type: 'text' | 'pdf' | 'set'; title: string; text?: string; characterCount: number; truncated?: boolean; setId?: string; pageCount?: number }) => current.type === 'set'
    ? { type: 'set', setId: current.setId }
    : { type: current.type, title: current.title, text: current.text, extractedChars: current.characterCount, truncated: current.truncated ?? false, ...(current.pageCount ? { pageCount: current.pageCount } : {}) },
  aiStudioService: {
    extractPdf: vi.fn(),
    summary: vi.fn(),
    cards: vi.fn(),
    quiz: vi.fn(),
    questions: vi.fn(),
    plan: vi.fn(),
    chat: vi.fn(),
  },
}));

vi.mock('../../services/studySetService', () => ({
  studySetService: {
    listMine: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  },
}));

const studio = vi.mocked(aiStudioService);
const sets = vi.mocked(studySetService);

const source = {
  id: 'text-test-source',
  type: 'text' as const,
  title: 'Biology notes',
  preview: 'Photosynthesis uses light energy to make glucose in plants.',
  characterCount: 59,
  text: 'Photosynthesis uses light energy to make glucose in plants.',
};
const actionSource = {
  type: 'text' as const,
  title: 'Pasted study material',
  text: source.text,
  extractedChars: source.characterCount,
  truncated: false,
};

function renderPage() {
  return render(<MemoryRouter initialEntries={['/ai/studio']}><AIStudioPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(studio.extractPdf).mockResolvedValue({
    title: 'Biology notes', text: source.text, pageCount: 2, characterCount: source.characterCount, truncated: false,
  });
  vi.mocked(sets.listMine).mockResolvedValue([]);
  vi.mocked(studio.summary).mockResolvedValue({
    title: 'Photosynthesis',
    summary: 'Plants use energy from light to make glucose.',
    keyPoints: ['Light provides energy.', 'Plants make glucose.', 'Chlorophyll absorbs light.'],
    terms: [],
    sourceTitle: 'Biology notes',
  });
  vi.mocked(studio.cards).mockResolvedValue({
    title: 'Photosynthesis',
    description: 'Review photosynthesis.',
    cards: [
      { front: 'What absorbs light?', back: 'Chlorophyll.' },
      { front: 'What do plants make?', back: 'Glucose.' },
      { front: 'What provides energy?', back: 'Light.' },
    ],
  });
  vi.mocked(studio.quiz).mockResolvedValue({
    questions: [{
      type: 'multiple_choice', question: 'What do plants make?', options: ['Glucose', 'Water', 'Soil', 'Salt'],
      correctIndex: 0, answer: 'Glucose', explanation: 'The source says plants make glucose.',
    }],
  });
  vi.mocked(studio.questions).mockResolvedValue({ questions: [] });
  vi.mocked(studio.plan).mockResolvedValue({
    title: 'Photosynthesis plan',
    overview: 'A short plan to review light energy and glucose over three study days.',
    sessions: [1, 2, 3].map((day) => ({ day, focus: `Focus ${day}`, activities: [`Review notes for day ${day}.`], minutes: 15 })),
  });
  vi.mocked(studio.chat).mockResolvedValue({ reply: 'Your source says plants make glucose.' });
  vi.mocked(sets.create).mockResolvedValue({ id: 'saved-set-id' } as never);
});

afterEach(() => vi.clearAllMocks());

describe('AI Study Studio flow', () => {
  it('does not ask AI before an action is chosen and shows a source preview first', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Paste your notes/), 'Photosynthesis uses light energy to make glucose in plants.');
    await user.click(screen.getByRole('button', { name: 'Preview this text' }));

    expect(await screen.findByLabelText('Source preview')).toBeInTheDocument();
    expect(screen.getByText(/Photosynthesis uses light energy/)).toBeInTheDocument();
    expect(studio.summary).not.toHaveBeenCalled();
    expect(studio.cards).not.toHaveBeenCalled();
    expect(studio.quiz).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Make a summary/ }));
    expect(await screen.findByText('Key points')).toBeInTheDocument();
    expect(studio.summary).toHaveBeenCalledWith(actionSource);
  });

  it('previews and edits flashcards, then saves explicitly through the normal set flow', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Paste your notes/), 'Photosynthesis uses light energy to make glucose in plants.');
    await user.click(screen.getByRole('button', { name: 'Preview this text' }));
    await user.click(screen.getByRole('button', { name: /Create flashcards/ }));

    expect(await screen.findByText(/Nothing is saved yet/)).toBeInTheDocument();
    expect(studio.cards).toHaveBeenCalledWith(actionSource, 10);
    const fronts = screen.getAllByLabelText('Front');
    await user.clear(fronts[0]!);
    await user.type(fronts[0]!, 'Edited front');
    await user.click(screen.getByRole('button', { name: 'Save as a private set' }));

    await waitFor(() => expect(sets.create).toHaveBeenCalledTimes(1));
    expect(sets.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Photosynthesis',
      visibility: 'private',
      cards: expect.arrayContaining([expect.objectContaining({ question: 'Edited front' })]),
    }));
    expect(await screen.findByText('Your set is saved.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open set/ })).toHaveAttribute('href', '/sets/saved-set-id');
  });

  it('supports a source-aware chat but sends only after the student submits a question', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Paste your notes/), 'Photosynthesis uses light energy to make glucose in plants.');
    await user.click(screen.getByRole('button', { name: 'Preview this text' }));
    await user.click(screen.getByRole('button', { name: /Ask about this source/ }));

    expect(studio.chat).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Ask Lerno AI about this source'), 'What do plants make?');
    await user.click(screen.getByRole('button', { name: 'Ask Lerno AI' }));
    expect(await screen.findByText('Your source says plants make glucose.')).toBeInTheDocument();
    expect(studio.chat).toHaveBeenCalledWith(actionSource, 'What do plants make?', []);
  });

  it('lets learners answer and check a quiz preview', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Paste your notes/), 'Photosynthesis uses light energy to make glucose in plants.');
    await user.click(screen.getByRole('button', { name: 'Preview this text' }));
    await user.click(screen.getByRole('button', { name: /Take a quiz/ }));
    expect(await screen.findByRole('heading', { name: 'What do plants make?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Glucose/ }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByText('That’s right.')).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('Glucose')).toBeInTheDocument();
  });

  it('creates a source-grounded study plan only when selected and previews its sessions', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(/Paste your notes/), 'Photosynthesis uses light energy to make glucose in plants.');
    await user.click(screen.getByRole('button', { name: 'Preview this text' }));

    expect(studio.plan).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Study plan length'), '3');
    await user.selectOptions(screen.getByLabelText('Time per study day'), '15');
    await user.click(screen.getByRole('button', { name: /Build a study plan/ }));

    expect(await screen.findByRole('heading', { name: 'Photosynthesis plan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Day 1: Focus 1' })).toBeInTheDocument();
    expect(studio.plan).toHaveBeenCalledWith(actionSource, 3, 15);
    expect(screen.getByText(/nothing has been saved/i)).toBeInTheDocument();
  });

  it('uses a private PDF extraction for preview, then sends its text only when a task is chosen', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Upload a PDF' }));
    const file = new File(['a valid-size pdf payload'], 'lesson.pdf', { type: 'application/pdf' });
    fireEvent.change(document.getElementById('studio-pdf-file')!, { target: { files: [file] } });

    expect(await screen.findByLabelText('Source preview')).toBeInTheDocument();
    expect(screen.getByText('PDF document · 59 characters · 2 pages')).toBeInTheDocument();
    expect(studio.extractPdf).toHaveBeenCalledWith(file, 'lesson');
    expect(studio.summary).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Make a summary/ }));
    await screen.findByText('Key points');
    expect(studio.summary).toHaveBeenCalledWith({
      type: 'pdf', title: 'Biology notes', text: source.text, pageCount: 2,
      extractedChars: 59, truncated: false,
    });
  });

  it('re-authorizes an existing set source on each chosen AI action', async () => {
    const user = userEvent.setup();
    const setSummary = { id: 'set-1', title: 'Biology set', cardCount: 2 };
    vi.mocked(sets.listMine).mockResolvedValue([setSummary] as never);
    vi.mocked(sets.get).mockResolvedValue({
      ...setSummary,
      cards: [
        { id: 'card-1', question: 'What do plants make?', answer: 'Glucose.', position: 0 },
        { id: 'card-2', question: 'What provides energy?', answer: 'Light.', position: 1 },
      ],
    } as never);
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Use a Lerno set' }));
    await user.selectOptions(await screen.findByLabelText('Choose one of your study sets'), 'set-1');
    await user.click(screen.getByRole('button', { name: 'Preview this set' }));
    expect(await screen.findByText(/Your Lerno set/)).toBeInTheDocument();
    expect(studio.summary).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Make a summary/ }));
    await screen.findByText('Key points');
    expect(studio.summary).toHaveBeenCalledWith({ type: 'set', setId: 'set-1' });
  });

  it('rejects non-PDF input in the browser before upload', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Upload a PDF' }));
    const file = new File(['not a pdf'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(document.getElementById('studio-pdf-file')!, { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PDF file.');
    expect(studio.extractPdf).not.toHaveBeenCalled();
  });
});
