import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { studyPackImportService } from '../../services/studyPackImportService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import { ApiError } from '../../lib/api';
import type {
  ImportProcessingStatus,
  ImportProcessingStep,
  ImportSourceStatus,
  ImportStarted,
  MaterialPdfPreview,
} from '../../types';
import { NewStudyPackPage } from './NewStudyPackPage';

vi.mock('../../services/studyPackImportService', () => ({
  studyPackImportService: {
    previewPdf: vi.fn(),
    create: vi.fn(),
    createFromUpload: vi.fn(),
    addYouTubeSource: vi.fn(),
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

const previewMock = vi.mocked(studyPackImportService.previewPdf);
const createMock = vi.mocked(studyPackImportService.create);
const createFromUploadMock = vi.mocked(studyPackImportService.createFromUpload);
const youTubeMock = vi.mocked(studyPackImportService.addYouTubeSource);
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

const STAGES: ImportProcessingStep['id'][] = [
  'extract',
  'normalize',
  'analyze',
  'generate',
  'review',
  'plan',
];

const STAGE_LABELS: Record<ImportProcessingStep['id'], string> = {
  extract: 'Reading your material',
  normalize: 'Cleaning up your material',
  analyze: 'Understanding your material',
  generate: 'Creating concepts, summary, flashcards and practice',
  review: 'Checking the generated content',
  plan: 'Building your study plan',
};

function steps(overrides: Partial<Record<ImportProcessingStep['id'], ImportProcessingStep['state']>>) {
  return STAGES.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    state: overrides[id] ?? ('pending' as const),
  }));
}

const SOURCE: ImportSourceStatus = {
  id: 'source-1',
  title: 'Biologie H3.pdf',
  kind: 'pdf',
  status: 'ready',
  stage: null,
  failureReason: null,
  referenceLabel: null,
  retryable: false,
  url: null,
};

const COUNTS = {
  concepts: 0,
  flashcards: 0,
  practiceQuestions: 0,
  hasSummary: false,
  hasPlan: false,
  hasAnalysis: false,
  sources: 1,
  readySources: 0,
  conflicts: 0,
  rejected: 0,
};

const PROCESSING: ImportProcessingStatus = {
  packId: 'pack-1',
  status: 'processing',
  stage: 'extract',
  stageLabel: STAGE_LABELS.extract,
  steps: steps({ extract: 'active' }),
  aiAvailable: true,
  aiSkipped: false,
  counts: COUNTS,
  failure: null,
  processing: true,
  sources: [SOURCE],
  estimatedMinutes: null,
  estimatedStudyTimeLabel: null,
  ready: false,
};

const READY: ImportProcessingStatus = {
  ...PROCESSING,
  status: 'ready',
  stage: null,
  stageLabel: null,
  steps: steps({ extract: 'done', normalize: 'done', analyze: 'done', generate: 'done', review: 'done', plan: 'done' }),
  counts: {
    ...COUNTS,
    concepts: 8,
    flashcards: 12,
    practiceQuestions: 6,
    hasSummary: true,
    hasPlan: true,
    hasAnalysis: true,
    readySources: 1,
  },
  processing: false,
  ready: true,
  estimatedMinutes: 45,
  estimatedStudyTimeLabel: '~45 min',
};

const STARTED: ImportStarted = { packId: 'pack-1', jobId: 'job-1', status: PROCESSING };

/** No AI configured: the three AI stages were skipped, reading and planning ran. */
const AI_SKIPPED: ImportProcessingStatus = {
  ...READY,
  status: 'partial',
  aiAvailable: false,
  aiSkipped: true,
  steps: steps({
    extract: 'done',
    normalize: 'done',
    analyze: 'skipped',
    generate: 'skipped',
    review: 'skipped',
    plan: 'done',
  }),
  counts: { ...COUNTS, hasPlan: true, readySources: 1 },
  estimatedMinutes: 10,
  estimatedStudyTimeLabel: '~10 min',
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

async function createFromText(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Text'), 'Cellen zijn de bouwstenen van leven en de celkern bevat het DNA.');
  await user.type(screen.getByLabelText('Title'), 'Biologie H3');
  await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));
}

describe('NewStudyPackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subjectsMock.mockResolvedValue([]);
    setsMock.mockResolvedValue([]);
    previewMock.mockResolvedValue(PDF_PREVIEW);
    createMock.mockResolvedValue(STARTED);
    createFromUploadMock.mockResolvedValue(STARTED);
    youTubeMock.mockResolvedValue(PROCESSING);
    statusMock.mockResolvedValue(READY);
    processMock.mockResolvedValue(READY);
  });

  it('offers every source type Lerno can really read', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Turn your material into a study pack' }),
    ).toBeInTheDocument();

    // Nothing says "coming soon": every source type has a real pipeline behind it.
    for (const label of [
      /PDF/,
      /PowerPoint/,
      /Photo of notes/,
      /Recording/,
      /YouTube/,
      /Existing Lerno set/,
      /Paste text/,
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: /PowerPoint/ }));
    expect(screen.getByRole('heading', { name: 'Upload your PowerPoint' })).toBeInTheDocument();
    expect(screen.getByText('.pptx')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Recording/ }));
    expect(screen.getByRole('heading', { name: 'Upload a recording' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /YouTube/ }));
    expect(screen.getByRole('heading', { name: 'Add a YouTube lesson' })).toBeInTheDocument();
  });

  it('creates a study pack from pasted text and reports the real stages', async () => {
    const user = userEvent.setup();
    // First poll still reports real work in progress; the next one is finished.
    statusMock.mockResolvedValueOnce(PROCESSING).mockResolvedValue(READY);
    renderPage();

    await screen.findByRole('heading', { name: 'Turn your material into a study pack' });
    await createFromText(user);

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Biologie H3',
          source: expect.objectContaining({ type: 'text' }),
          settings: expect.objectContaining({ flashcards: 20, practice: 10, difficulty: 'medium' }),
        }),
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Processing your material' })).toBeInTheDocument();
    expect(screen.getByText('Reading your material')).toBeInTheDocument();
    expect(
      screen.getByText('Creating concepts, summary, flashcards and practice'),
    ).toBeInTheDocument();

    // The end of the import is a real result screen: counts, study time and the
    // primary action that hands the student to the adaptive engine.
    // The next poll runs after one interval, so the ready screen needs patience.
    expect(
      await screen.findByRole('heading', { name: 'Your Study Pack is ready' }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('~45 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start Learning/ })).toHaveAttribute(
      'href',
      '/study-packs/pack-1?tab=learn',
    );
    expect(screen.getByRole('button', { name: 'Review material' })).toBeInTheDocument();
  });

  it('passes the student generation settings to the generator', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Turn your material into a study pack' });
    const thirties = screen.getAllByRole('button', { name: '30' });
    await user.click(thirties[0]);
    await user.click(thirties[1]);
    await user.click(screen.getByRole('button', { name: 'Hard' }));
    await user.click(screen.getByRole('button', { name: 'English' }));

    await createFromText(user);

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: { flashcards: 30, practice: 30, difficulty: 'hard', language: 'en' },
        }),
      ),
    );
  });

  it('keeps Create Study Pack disabled until pasted text is usable', async () => {
    const user = userEvent.setup();
    renderPage();

    const create = await screen.findByRole('button', { name: 'Create Study Pack' });
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
    expect(screen.getByRole('heading', { name: 'Upload your PDF' })).toBeInTheDocument();
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

    await screen.findByRole('heading', { name: 'Turn your material into a study pack' });
    await createFromText(user);

    expect(await screen.findByText('This material may already exist')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open existing Study Pack' });
    expect(open).toHaveAttribute('href', '/study-packs/pack-9');
    expect(screen.getByRole('button', { name: 'Import anyway' })).toBeInTheDocument();

    createMock.mockResolvedValueOnce(STARTED);
    await user.click(screen.getByRole('button', { name: 'Import anyway' }));
    await waitFor(() =>
      expect(createMock).toHaveBeenLastCalledWith(expect.objectContaining({ allowDuplicate: true })),
    );
  });

  it('reports processing stages and a skipped AI step honestly', async () => {
    const user = userEvent.setup();
    statusMock.mockResolvedValue(AI_SKIPPED);
    renderPage();

    await screen.findByRole('heading', { name: 'Turn your material into a study pack' });
    await createFromText(user);

    // One "Skipped" per AI stage that really did not run, never for reading.
    expect(await screen.findAllByText('Skipped')).toHaveLength(3);
    expect(await screen.findByText('AI generation unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open study pack' })).toBeInTheDocument();
  });

  it('lets the student retry when processing failed', async () => {
    const user = userEvent.setup();
    const failed: ImportProcessingStatus = {
      ...READY,
      status: 'failed',
      failure: {
        stage: 'analyze',
        message: 'We could not finish generating content for this material.',
        details: 'AI_TIMEOUT: upstream did not answer',
      },
      steps: [
        { id: 'extract', label: STAGE_LABELS.extract, state: 'done' },
        { id: 'normalize', label: STAGE_LABELS.normalize, state: 'done' },
        { id: 'analyze', label: STAGE_LABELS.analyze, state: 'failed' },
      ],
      processing: false,
      sources: [],
      counts: COUNTS,
      ready: false,
      estimatedMinutes: null,
      estimatedStudyTimeLabel: null,
    };
    statusMock.mockResolvedValueOnce(failed).mockResolvedValue(READY);
    renderPage();

    await screen.findByRole('heading', { name: 'Turn your material into a study pack' });
    await createFromText(user);

    expect(await screen.findByText("We couldn't process this file")).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(processMock).toHaveBeenCalledWith('pack-1');
    expect(await screen.findByRole('heading', { name: 'Your Study Pack is ready' })).toBeInTheDocument();
  });

  it('asks for the transcript when a video has no usable captions', async () => {
    const user = userEvent.setup();
    const youTubeFailed: ImportProcessingStatus = {
      ...READY,
      status: 'partial',
      steps: steps({ extract: 'done', normalize: 'done', analyze: 'failed' }),
      processing: false,
      ready: true,
      sources: [
        {
          id: 'source-yt',
          title: 'Celbiologie',
          kind: 'youtube',
          status: 'failed',
          stage: 'extract',
          failureReason: "This video doesn't have usable captions. Paste the transcript instead.",
          referenceLabel: null,
          retryable: true,
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
        },
      ],
      counts: { ...COUNTS, readySources: 0 },
    };
    statusMock.mockResolvedValue(youTubeFailed);
    youTubeMock.mockResolvedValue(READY);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /YouTube/ }));
    await user.type(screen.getByLabelText('Video link'), 'https://www.youtube.com/watch?v=abcdefghijk');
    await user.type(screen.getByLabelText('Title'), 'Celbiologie');
    await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));

    expect(await screen.findByText(/doesn't have usable captions/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Paste the transcript' }));
    await user.type(
      screen.getByLabelText(/Paste the transcript/),
      'De celkern bevat het DNA en regelt wat de cel doet. Mitose is de deling van de celkern.',
    );
    await user.click(screen.getByRole('button', { name: 'Use this transcript' }));

    await waitFor(() =>
      expect(youTubeMock).toHaveBeenCalledWith(
        'pack-1',
        expect.objectContaining({
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          transcript: expect.stringContaining('De celkern bevat het DNA'),
        }),
      ),
    );
  });

  it('uploads slides through the same pipeline', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /PowerPoint/ }));
    const file = new File(['pptx'], 'Biologie H3.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    await user.upload(screen.getByLabelText(/Choose a file from your device/), file);

    expect(screen.getByText(/Biologie H3\.pptx/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create Study Pack' }));

    await waitFor(() =>
      expect(createFromUploadMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'powerpoint', title: 'Biologie H3' }),
        expect.anything(),
      ),
    );
  });

  it(
    'shows a friendly message when the network is lost, not a stack trace',
    async () => {
      const user = userEvent.setup();
      statusMock.mockRejectedValue(new ApiError('Network request failed', 'NETWORK_ERROR', 0));
      renderPage();

      await screen.findByRole('heading', { name: 'Turn your material into a study pack' });
      await createFromText(user);

      // The poll retries a few times with backoff, then explains the problem in
      // plain language instead of surfacing the raw network error.
      expect(
        await screen.findByText(/We lost the connection while building your study pack/, {}, { timeout: 15000 }),
      ).toBeInTheDocument();
      expect(screen.queryByText('NETWORK_ERROR')).not.toBeInTheDocument();
    },
    20000,
  );
});
