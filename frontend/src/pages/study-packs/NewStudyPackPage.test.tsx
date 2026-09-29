import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { studyPackImportService } from '../../services/studyPackImportService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import { ApiError } from '../../lib/api';
import type { ImportProcessingStatus, ImportStarted, MaterialPdfPreview } from '../../types';
import { NewStudyPackPage } from './NewStudyPackPage';

vi.mock('../../services/studyPackImportService', () => ({
  studyPackImportService: {
    previewPdf: vi.fn(),
    create: vi.fn(),
    status: vi.fn(),
    process: vi.fn(),
  },
}));

vi.mock('../../services/subjectService', () => ({
  subjectService: { list: vi.fn() },
}));

vi.mock('../../services/studySetService', () => ({
  studySetService: { listMine: vi.fn() },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', profile: { displayName: 'Sam' } } }),
}));

const previewMock = vi.mocked(studyPackImportService.previewPdf);
const createMock = vi.mocked(studyPackImportService.create);
const statusMock = vi.mocked(studyPackImportService.status);
const processMock = vi.mocked(studyPackImportService.process);
const subjectsMock = vi.mocked(subjectService.list);
const setsMock = vi.mocked(studySetService.listMine);

const PDF_PREVIEW: MaterialPdfPreview = {
  title: 'Biologie H3',
  text: 'Cellen zijn de bouwstenen van leven. De celkern bevat het DNA.',
  pageCount: 14,
  wordCount: 3200,
  characterCount: 18000,
  truncated: false,
  concepts: [
    { name: 'Celkern', explanation: 'De celkern bevat het DNA.' },
    { name: 'Mitose', explanation: 'Mitose is de deling van de celkern.' },
  ],
};

const PROCESSING_STEPS = [
  { id: 'concepts' as const, label: 'Finding important concepts', state: 'active' as const },
  { id: 'summary' as const, label: 'Writing a summary', state: 'pending' as const },
  { id: 'flashcards' as const, label: 'Creating flashcards', state: 'pending' as const },
  { id: 'practice' as const, label: 'Creating practice questions', state: 'pending' as const },
  { id: 'plan' as const, label: 'Building your study plan', state: 'pending' as const },
];

const STARTED: ImportStarted = {
  packId: 'pack-1',
  jobId: 'job-1',
  status: {
    packId: 'pack-1',
    status: 'processing',
    stage: 'concepts',
    stageLabel: 'Finding important concepts',
    steps: PROCESSING_STEPS,
    aiAvailable: true,
    aiSkipped: false,
    counts: { concepts: 0, flashcards: 0, practiceQuestions: 0, hasSummary: false, hasPlan: false },
    failure: null,
    processing: true,
  },
};

const READY: ImportProcessingStatus = {
  ...STARTED.status,
  status: 'ready',
  stage: 'plan',
  stageLabel: 'Building your study plan',
  steps: PROCESSING_STEPS.map((step) => ({ ...step, state: 'done' as const })),
  counts: { concepts: 8, flashcards: 12, practiceQuestions: 6, hasSummary: true, hasPlan: true },
  processing: false,
};

/** No AI configured: the four AI stages were skipped, the plan still ran. */
const AI_SKIPPED: ImportProcessingStatus = {
  ...READY,
  status: 'partial',
  aiAvailable: false,
  aiSkipped: true,
  steps: PROCESSING_STEPS.map((step) => ({
    ...step,
    state: step.id === 'plan' ? ('done' as const) : ('skipped' as const),
  })),
  counts: { concepts: 0, flashcards: 0, practiceQuestions: 0, hasSummary: false, hasPlan: true },
};

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/study-packs/new']}>
      <ToastProvider>
        <Routes>
          <Route path="/study-packs/new" element={<NewStudyPackPage />} />
          <Route path="/study-packs/:packId" element={<p>Pack page</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('NewStudyPackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subjectsMock.mockResolvedValue([]);
    setsMock.mockResolvedValue([]);
    previewMock.mockResolvedValue(PDF_PREVIEW);
    createMock.mockResolvedValue(STARTED);
    statusMock.mockResolvedValue(READY);
    processMock.mockResolvedValue(READY);
  });

  it('offers one import experience per input type and marks the rest coming soon', async () => {
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Turn your material into a study pack' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /PDF/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Existing Lerno set/ })).toBeInTheDocument();

    // Unsupported inputs are honest about it instead of pretending to work.
    for (const comingSoon of [/PowerPoint/, /Image/, /Audio/, /YouTube/]) {
      const option = screen.getByText(comingSoon).closest('.import-option')!;
      expect(option).toHaveAttribute('aria-disabled', 'true');
      expect(within(option as HTMLElement).getByText('Coming soon')).toBeInTheDocument();
    }
  });

  it('creates a study pack from pasted text and redirects to the pack', async () => {
    const user = userEvent.setup();
    // First poll still reports real work in progress; the next one is finished.
    statusMock.mockResolvedValueOnce(STARTED.status).mockResolvedValue(READY);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Paste text/ }));
    await user.type(
      screen.getByLabelText('Text'),
      'Cellen zijn de bouwstenen van leven en de celkern bevat het DNA.',
    );
    await user.type(screen.getByLabelText('Title'), 'Biologie H3');
    await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Biologie H3',
          source: expect.objectContaining({ type: 'text' }),
        }),
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Processing your material' })).toBeInTheDocument();
    expect(screen.getByText('Finding important concepts')).toBeInTheDocument();
    expect(screen.getByText('Creating flashcards')).toBeInTheDocument();
    // Polling reports real stages; once ready the student lands on the pack.
    expect(await screen.findByText('Pack page', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('keeps Create Study Pack disabled until pasted text is usable', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Write notes/ }));
    const create = screen.getByRole('button', { name: 'Create Study Pack' });
    expect(create).toBeDisabled();

    await user.type(screen.getByLabelText('Title'), 'Aantekeningen');
    await user.type(screen.getByLabelText('Text'), 'kort');
    expect(create).toBeDisabled();

    await user.type(
      screen.getByLabelText('Text'),
      ' en nu een stuk tekst dat lang genoeg is om echt bruikbaar materiaal te zijn.',
    );
    expect(create).toBeEnabled();
  });

  it('shows what Lerno found in the PDF before creating the pack', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /PDF/ }));
    const file = new File(['%PDF-1.4'], 'Biologie H3.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/Choose a PDF/), file);

    expect(await screen.findByText('We found')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('~3,200')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/concepts detected/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Biologie H3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Study Pack' })).toBeEnabled();
  });

  it('explains a failed PDF read without losing the page', async () => {
    const user = userEvent.setup();
    previewMock.mockRejectedValue(
      new ApiError('We could not read text from this PDF.', 'VALIDATION_ERROR', 400),
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: /PDF/ }));
    const file = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/Choose a PDF/), file);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not read text from this PDF.',
    );
    expect(screen.getByRole('button', { name: /Choose another file/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Study Pack' })).not.toBeInTheDocument();
  });

  it('asks before importing material that already exists', async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValueOnce(
      new ApiError('This material may already exist', 'CONFLICT', 409, {
        reason: 'duplicate-source',
        packId: 'pack-9',
        packTitle: 'Biologie H2',
        sourceId: 'source-9',
        sourceTitle: 'Biologie H3.pdf',
      }),
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Paste text/ }));
    await user.type(screen.getByLabelText('Title'), 'Biologie H3');
    await user.type(
      screen.getByLabelText('Text'),
      'Cellen zijn de bouwstenen van leven en de celkern bevat het DNA.',
    );
    await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));

    expect(await screen.findByText('This material may already exist')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open existing Study Pack' });
    expect(open).toHaveAttribute('href', '/study-packs/pack-9');
    expect(screen.getByRole('button', { name: 'Import anyway' })).toBeInTheDocument();

    createMock.mockResolvedValueOnce(STARTED);
    await user.click(screen.getByRole('button', { name: 'Import anyway' }));
    await waitFor(() =>
      expect(createMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ allowDuplicate: true }),
      ),
    );
  });

  it('reports processing stages and a skipped AI step honestly', async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValue(STARTED);
    statusMock.mockResolvedValue(AI_SKIPPED);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Paste text/ }));
    await user.type(screen.getByLabelText('Title'), 'Biologie H3');
    await user.type(
      screen.getByLabelText('Text'),
      'Cellen zijn de bouwstenen van leven en de celkern bevat het DNA.',
    );
    await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));

    expect(await screen.findAllByText('Skipped')).toHaveLength(4);
    expect(await screen.findByText('AI generation unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open study pack' })).toBeInTheDocument();
  });

  it('lets the student retry when processing failed', async () => {
    const user = userEvent.setup();
    const failed: ImportProcessingStatus = {
      ...READY,
      status: 'failed',
      failure: {
        stage: 'concepts',
        message: 'We could not finish generating content for this material.',
        details: 'AI_TIMEOUT: upstream did not answer',
      },
      steps: [
        { id: 'concepts', label: 'Finding important concepts', state: 'failed' },
        { id: 'summary', label: 'Writing a summary', state: 'pending' },
      ],
      processing: false,
    };
    statusMock.mockResolvedValueOnce(failed).mockResolvedValue(READY);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Paste text/ }));
    await user.type(screen.getByLabelText('Title'), 'Biologie H3');
    await user.type(
      screen.getByLabelText('Text'),
      'Cellen zijn de bouwstenen van leven en de celkern bevat het DNA.',
    );
    await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));

    expect(await screen.findByText("We couldn't process this file")).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(processMock).toHaveBeenCalledWith('pack-1');
    expect(await screen.findByText('Pack page')).toBeInTheDocument();
  });

  it(
    'shows a friendly message when the network is lost, not a stack trace',
    async () => {
      const user = userEvent.setup();
      statusMock.mockRejectedValue(new ApiError('Network request failed', 'NETWORK_ERROR', 0));
      renderPage();

      await user.click(await screen.findByRole('button', { name: /Paste text/ }));
      await user.type(screen.getByLabelText('Title'), 'Biologie H3');
      await user.type(
        screen.getByLabelText('Text'),
        'Cellen zijn de bouwstenen van leven en de celkern bevat het DNA.',
      );
      await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));

      // The poll retries a few times with backoff, then explains the problem in
      // plain language instead of surfacing the raw network error.
      expect(
        await screen.findByText(
          /We lost the connection while building your study pack/,
          {},
          { timeout: 15000 },
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('NETWORK_ERROR')).not.toBeInTheDocument();
    },
    20000,
  );
});
