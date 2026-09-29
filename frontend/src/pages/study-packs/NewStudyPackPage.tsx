import { useMemo, useRef, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { LoadingRow } from '../../components/ui/Primitives';
import {
  IconArrowRight,
  IconAudio,
  IconBook,
  IconFile,
  IconImage,
  IconLayers,
  IconUpload,
  IconVideo,
} from '../../components/ui/Icons';
import { ImportProcessing } from '../../components/study-pack/ImportProcessing';
import { PackReadySummary } from '../../components/study-pack/PackReadySummary';
import { useToast } from '../../components/ui/Toast';
import { useAsync } from '../../hooks/useAsync';
import { ApiError } from '../../lib/api';
import { studyPackImportService } from '../../services/studyPackImportService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type {
  DuplicateMaterialRef,
  GenerationSettings,
  ImportProcessingStatus,
  MaterialPdfPreview,
} from '../../types';

type Mode = 'text' | 'pdf' | 'powerpoint' | 'image' | 'audio' | 'youtube' | 'set';

const LEVEL_SUGGESTIONS = [
  '1 VMBO',
  '3 MAVO',
  '4 HAVO',
  '5 VWO',
  'MBO',
  'HBO',
  'Universiteit',
];

const MIN_TEXT_CHARS = 20;
const COUNT_OPTIONS = [10, 20, 30] as const;

/** Accepted-by-browser hints; the backend validates the real type and content. */
const ACCEPT: Record<'pdf' | 'powerpoint' | 'image' | 'audio', string> = {
  pdf: 'application/pdf,.pdf',
  powerpoint: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation',
  image: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp',
  audio: 'audio/mpeg,audio/wav,audio/mp4,audio/webm,.mp3,.wav,.m4a,.webm',
};

const UPLOAD_KINDS = ['pdf', 'powerpoint', 'image', 'audio'] as const;

function isUploadMode(mode: Mode): mode is (typeof UPLOAD_KINDS)[number] {
  return (UPLOAD_KINDS as readonly string[]).includes(mode);
}

function materialStateLabel(phase: 'uploading' | 'reading', progress: number): string {
  if (phase === 'uploading') {
    return progress > 0 && progress < 100
      ? `Uploading your file… ${progress}%`
      : 'Uploading your file…';
  }
  return 'Reading your file…';
}

/** The three generation knobs a student gets — deliberately nothing more. */
const DEFAULT_SETTINGS: GenerationSettings = {
  flashcards: 20,
  practice: 10,
  difficulty: 'medium',
  language: 'nl',
};

/**
 * "Add study material" — the one place where a student brings material in.
 *
 * Every accepted kind uses the same pipeline: the server reads the material
 * (PDF text, PPTX slides, OCR, transcription, YouTube metadata + the student's
 * own transcript), normalizes it, analyzes it and generates content with
 * provenance. The processing screen reports the stages the backend really runs,
 * and the ready screen reports the real counts and the rule-based study time.
 */
export function NewStudyPackPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: subjects, loading: subjectsLoading } = useAsync(() => subjectService.list(), []);
  const { data: mySets } = useAsync(() => studySetService.listMine(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>('text');
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [level, setLevel] = useState('');
  const [text, setText] = useState('');
  const [setId, setSetId] = useState('');
  const [pdf, setPdf] = useState<{ preview: MaterialPdfPreview; fileName: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [youTubeUrl, setYouTubeUrl] = useState('');
  const [youTubeTranscript, setYouTubeTranscript] = useState('');
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS);
  const [upload, setUpload] = useState<{ phase: 'idle' | 'uploading' | 'reading'; progress: number }>(
    { phase: 'idle', progress: 0 },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<(DuplicateMaterialRef & { raw: string }) | null>(null);
  const [started, setStarted] = useState<{ packId: string; status: ImportProcessingStatus } | null>(
    null,
  );
  const [finished, setFinished] = useState<{ packId: string; status: ImportProcessingStatus } | null>(
    null,
  );

  const wordCount = useMemo(
    () => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
    [text],
  );
  const readableChars = text.replace(/\s/g, '').length;
  const pickedSet = (mySets ?? []).find((set) => set.id === setId) ?? null;

  const canCreate =
    busy || !title.trim()
      ? false
      : mode === 'set'
        ? Boolean(setId)
        : mode === 'text'
          ? readableChars >= MIN_TEXT_CHARS
          : mode === 'youtube'
            ? youTubeUrl.trim().length > 5
            : mode === 'pdf'
              ? Boolean(pdf)
              : Boolean(file);

  function selectMode(next: Mode) {
    setMode(next);
    setError(null);
    setDuplicate(null);
    if (next !== mode) setTitle('');
  }

  async function choosePdf(fileChosen: File) {
    setError(null);
    setDuplicate(null);
    setPdf(null);
    setUpload({ phase: 'uploading', progress: 0 });
    try {
      const preview = await studyPackImportService.previewPdf(fileChosen, {
        onProgress: (percent) => setUpload({ phase: 'uploading', progress: percent }),
      });
      setUpload({ phase: 'reading', progress: 100 });
      setPdf({ preview, fileName: fileChosen.name });
      setTitle(preview.title);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'This PDF could not be read. Paste the text instead.',
      );
    } finally {
      setUpload({ phase: 'idle', progress: 0 });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function chooseFile(fileChosen: File) {
    setFile(fileChosen);
    setError(null);
    setDuplicate(null);
    if (!title.trim()) setTitle(fileChosen.name.replace(/\.[^.]+$/, '').slice(0, 160));
  }

  async function create(allowDuplicate = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const title_ = title.trim() || pdf?.preview.title || pickedSet?.title || file?.name || 'Study pack';

      // File uploads are read server-side (PDF text, PPTX, OCR, transcription).
      if (mode !== 'pdf' && isUploadMode(mode) && file) {
        const result = await studyPackImportService.createFromUpload(
          {
            kind: mode,
            file,
            title: title_,
            subjectId: subjectId || null,
            level: level.trim(),
            allowDuplicate,
            settings,
          },
          {
            onProgress: (percent) => setUpload({ phase: 'uploading', progress: percent }),
          },
        );
        setUpload({ phase: 'idle', progress: 0 });
        setDuplicate(null);
        setStarted({ packId: result.packId, status: result.status });
        return;
      }

      const result = await studyPackImportService.create({
        title: title_,
        subjectId: subjectId || null,
        level: level.trim(),
        allowDuplicate,
        settings,
        source:
          mode === 'set'
            ? { type: 'set', setId, title: pickedSet?.title ?? 'Existing Lerno set' }
            : mode === 'youtube'
              ? {
                  type: 'youtube',
                  title: title_,
                  url: youTubeUrl.trim(),
                  ...(youTubeTranscript.trim() ? { transcript: youTubeTranscript.trim() } : {}),
                }
              : mode === 'pdf' && pdf
                ? {
                    type: 'pdf',
                    title: pdf.fileName,
                    text: pdf.preview.text,
                    pageCount: pdf.preview.pageCount,
                  }
                : { type: 'text', title: title_ || 'Pasted notes', text },
      });
      setDuplicate(null);
      setStarted({ packId: result.packId, status: result.status });
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        const details = requestError.details as DuplicateMaterialRef | null;
        if (details?.packId) {
          setDuplicate({ ...details, raw: requestError.message });
          setBusy(false);
          return;
        }
      }
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Your study pack could not be created. Please try again.',
      );
      toast.show('We could not create this study pack', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The end of an import is a real result screen (counts + study time + Start
   * Learning). A failed run stays on the processing screen so the failure and
   * its retry are visible first.
   */
  function finish(status: ImportProcessingStatus) {
    if (status.status === 'ready' || status.status === 'partial') {
      setFinished({ packId: status.packId, status });
    }
  }

  if (started) {
    const result = finished && finished.packId === started.packId ? finished : null;
    return (
      <div className="import-page">
        <header className="import-hero">
          <span className="eyebrow-label">Add study material</span>
          <h1>{result ? 'You are all set' : 'Lerno is building your study pack'}</h1>
          <p>
            {result
              ? 'Your material is saved and organized. You can add more material at any time.'
              : 'You can leave this page whenever you want: your material is saved and the study pack is already in My Study.'}
          </p>
        </header>

        {result ? (
          <PackReadySummary
            packId={result.packId}
            status={result.status}
            onReviewMaterial={() => navigate(`/study-packs/${result.packId}?tab=overview`)}
          />
        ) : null}

        <ImportProcessing
          packId={started.packId}
          initialStatus={started.status}
          onFinished={finish}
          onOpenPack={() => navigate(`/study-packs/${started.packId}`)}
        />

        {result ? (
          <div className="import-processing-actions">
            <ButtonLink variant="secondary" to="/study-packs">
              Back to My Study
            </ButtonLink>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="import-page">
      <header className="import-hero">
        <span className="eyebrow-label">Add study material</span>
        <h1>Turn your material into a study pack</h1>
        <p>
          Upload notes, slides, a photo or a recording, paste your material, or bring in a video.
          Lerno reads it, understands it and builds summaries, concepts, flashcards and practice.
        </p>
      </header>

      <section aria-labelledby="import-choose-heading" className="import-choose">
        <div className="import-section-head">
          <h2 id="import-choose-heading">What are you studying?</h2>
          <p className="muted">Pick where your material comes from. You can add more later.</p>
        </div>

        <div className="import-groups">
          <div className="import-group">
            <span className="import-group-label">Upload</span>
            <div className="import-options">
              {(
                [
                  ['pdf', 'PDF', 'A chapter, summary or reader with selectable text.', IconFile],
                  ['powerpoint', 'PowerPoint', 'Slides, including titles and speaker notes.', IconLayers],
                  ['image', 'Photo of notes', 'PNG, JPG or WEBP — Lerno reads the text (OCR).', IconImage],
                  ['audio', 'Recording', 'MP3, WAV, M4A or WEBM — Lerno transcribes it.', IconAudio],
                ] as [Mode, string, string, ComponentType<{ size?: number }>][]
              ).map(([id, label, description, Icon]) => (
                <OptionCard
                  key={id}
                  title={label}
                  description={description}
                  Icon={Icon}
                  active={mode === id}
                  onClick={() => selectMode(id)}
                />
              ))}
            </div>
          </div>

          <div className="import-group">
            <span className="import-group-label">Import</span>
            <div className="import-options">
              <OptionCard
                title="YouTube"
                description="Public title and channel, plus captions you paste yourself."
                Icon={IconVideo}
                active={mode === 'youtube'}
                onClick={() => selectMode('youtube')}
              />
              <OptionCard
                title="Existing Lerno set"
                description="Turn a set you already have into a study pack."
                Icon={IconBook}
                active={mode === 'set'}
                onClick={() => selectMode('set')}
              />
            </div>
          </div>

          <div className="import-group">
            <span className="import-group-label">Write</span>
            <div className="import-options">
              <OptionCard
                title="Paste text"
                description="Notes, a summary or copied material."
                Icon={IconUpload}
                active={mode === 'text'}
                onClick={() => selectMode('text')}
              />
            </div>
          </div>
        </div>
      </section>

      {duplicate ? (
        <section className="card import-panel import-duplicate" role="alert">
          <h2>You already have this material</h2>
          <p>{duplicate.raw}</p>
          <p>
            “{duplicate.sourceTitle}” is already in <strong>{duplicate.packTitle}</strong>. Importing
            it again would create a second study pack from the same material.
          </p>
          <div className="import-processing-actions">
            <ButtonLink to={`/study-packs/${duplicate.packId}`}>Open existing Study Pack</ButtonLink>
            <Button variant="secondary" onClick={() => void create(true)} disabled={busy}>
              {busy ? 'Importing…' : 'Import anyway'}
            </Button>
          </div>
        </section>
      ) : null}

      {mode === 'pdf' ? (
        <section className="card import-panel" aria-labelledby="import-pdf-heading">
          <div className="import-panel-head">
            <div>
              <h2 id="import-pdf-heading">Upload your PDF</h2>
              <p className="muted">
                Selectable text only. A scanned PDF has no text layer — use a photo instead and
                Lerno will read it with OCR.
              </p>
            </div>
          </div>

          {!pdf ? (
            <>
              <label className="import-drop">
                <IconUpload size={22} />
                <strong>Choose a PDF from your device</strong>
                <small>Up to 15 MB and 100 pages.</small>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT.pdf}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void choosePdf(chosen);
                  }}
                />
                {upload.phase !== 'idle' ? (
                  <span className="import-upload-status" role="status">
                    {materialStateLabel(upload.phase, upload.progress)}
                  </span>
                ) : null}
              </label>
              {error ? (
                <>
                  <p className="import-error" role="alert">
                    {error}
                  </p>
                  <button
                    type="button"
                    className="import-link"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose another file
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <>
              <div className="import-found">
                <span className="eyebrow-label">We found</span>
                <ul className="import-found-list">
                  <li>
                    <strong>{pdf.preview.pageCount}</strong> page
                    {pdf.preview.pageCount === 1 ? '' : 's'}
                  </li>
                  <li>
                    <strong>~{pdf.preview.wordCount.toLocaleString()}</strong> words
                  </li>
                  <li>
                    <strong>{pdf.preview.concepts.length}</strong> concept
                    {pdf.preview.concepts.length === 1 ? '' : 's'} detected
                  </li>
                </ul>
                {pdf.preview.truncated ? (
                  <p className="muted">
                    This PDF is long. Lerno uses the first part and you can add more material later.
                  </p>
                ) : null}
                <p className="import-file-line">
                  <IconFile size={15} /> {pdf.fileName}
                </p>
              </div>

              <details className="import-concepts">
                <summary>See what Lerno found in your material</summary>
                <ul>
                  {pdf.preview.concepts.slice(0, 12).map((concept) => (
                    <li key={concept.name}>
                      <strong>{concept.name}</strong>
                      <span className="muted">{concept.explanation}</span>
                    </li>
                  ))}
                </ul>
              </details>

              <button
                type="button"
                className="import-link"
                onClick={() => {
                  setPdf(null);
                  setTitle('');
                  fileInputRef.current?.click();
                }}
              >
                Choose a different file
              </button>
            </>
          )}
        </section>
      ) : null}

      {mode === 'powerpoint' || mode === 'image' || mode === 'audio' ? (
        <section className="card import-panel" aria-labelledby="import-file-heading">
          <div className="import-panel-head">
            <div>
              <h2 id="import-file-heading">
                {mode === 'powerpoint'
                  ? 'Upload your PowerPoint'
                  : mode === 'image'
                    ? 'Upload a photo of your notes'
                    : 'Upload a recording'}
              </h2>
              <p className="muted">
                {mode === 'powerpoint'
                  ? 'Lerno reads the slide text, the titles and the speaker notes.'
                  : mode === 'image'
                    ? 'Clear, straight-on photos work best. If Lerno finds no readable text, it says so instead of pretending.'
                    : 'Lerno transcribes the recording and keeps the timestamps, so generated items can point back to the exact moment.'}
              </p>
            </div>
          </div>
          <label className="import-drop">
            <IconUpload size={22} />
            <strong>Choose a file from your device</strong>
            <small>{mode === 'image' ? 'PNG, JPG or WEBP' : mode === 'audio' ? 'MP3, WAV, M4A or WEBM' : '.pptx'}</small>
            <input
              type="file"
              accept={ACCEPT[mode]}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) chooseFile(chosen);
              }}
            />
          </label>
          {file ? (
            <p className="import-file-line">
              <IconFile size={15} /> {file.name}
            </p>
          ) : null}
          {upload.phase !== 'idle' ? (
            <span className="import-upload-status" role="status">
              {materialStateLabel(upload.phase, upload.progress)}
            </span>
          ) : null}
        </section>
      ) : null}

      {mode === 'youtube' ? (
        <section className="card import-panel" aria-labelledby="import-youtube-heading">
          <div className="import-panel-head">
            <div>
              <h2 id="import-youtube-heading">Add a YouTube lesson</h2>
              <p className="muted">
                Lerno reads the public title and channel. It never downloads the video. Generated
                content can only use captions you have the right to use — paste the transcript from
                YouTube's own transcript panel.
              </p>
            </div>
          </div>
          <label className="field">
            <span>Video link</span>
            <input
              className="input"
              value={youTubeUrl}
              maxLength={500}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(event) => setYouTubeUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Transcript (optional — without it, Lerno cannot use the video)</span>
            <textarea
              className="textarea"
              rows={5}
              value={youTubeTranscript}
              maxLength={50_000}
              placeholder="Paste the transcript here…"
              onChange={(event) => setYouTubeTranscript(event.target.value)}
            />
          </label>
        </section>
      ) : null}

      {mode === 'text' ? (
        <section className="card import-panel" aria-labelledby="import-text-heading">
          <div className="import-panel-head">
            <div>
              <h2 id="import-text-heading">Paste your material</h2>
              <p className="muted">Notes, a summary or copied text from a reader.</p>
            </div>
          </div>
          <label className="field">
            <span>Text</span>
            <textarea
              className="textarea import-textarea"
              rows={12}
              value={text}
              maxLength={50_000}
              placeholder="Paste your notes here…"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <p className="import-hint" aria-live="polite">
            {wordCount} words · {readableChars} characters
            {readableChars > 0 && readableChars < MIN_TEXT_CHARS
              ? ` · add at least ${MIN_TEXT_CHARS} readable characters`
              : ''}
          </p>
        </section>
      ) : null}

      {mode === 'set' ? (
        <section className="card import-panel" aria-labelledby="import-set-heading">
          <div className="import-panel-head">
            <div>
              <h2 id="import-set-heading">Import an existing set</h2>
              <p className="muted">
                Your cards stay exactly where they are; Lerno adds concepts, a summary and practice.
              </p>
            </div>
          </div>
          <label className="field">
            <span>Study set</span>
            <select
              className="select"
              value={setId}
              onChange={(event) => {
                setSetId(event.target.value);
                const chosen = (mySets ?? []).find((set) => set.id === event.target.value);
                if (chosen) setTitle(chosen.title);
              }}
            >
              <option value="">Choose one of your sets…</option>
              {(mySets ?? []).map((set) => (
                <option key={set.id} value={set.id}>
                  {set.title} ({set.cardCount} cards)
                </option>
              ))}
            </select>
          </label>
          {(mySets ?? []).length === 0 ? (
            <p className="muted">
              You have no sets yet. <Link to="/sets/new">Create a set</Link> or paste your material.
            </p>
          ) : null}
        </section>
      ) : null}

      {mode !== 'pdf' || pdf ? (
        <section className="card import-details" aria-labelledby="import-details-heading">
          <div className="import-panel-head">
            <div>
              <h2 id="import-details-heading">
                {mode === 'pdf' ? 'Study Pack' : 'Name your study pack'}
              </h2>
              <p className="muted">This is how it shows up in My Study.</p>
            </div>
          </div>

          <div className="import-details-grid">
            <label className="field">
              <span>Title</span>
              <input
                className="input"
                value={title}
                maxLength={160}
                placeholder="Biologie hoofdstuk 3"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Subject</span>
              <select
                className="select"
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                <option value="">{subjectsLoading ? 'Loading…' : 'No subject'}</option>
                {(subjects ?? []).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Level</span>
              <input
                className="input"
                value={level}
                maxLength={60}
                list="import-level-suggestions"
                placeholder="3 MAVO"
                onChange={(event) => setLevel(event.target.value)}
              />
              <datalist id="import-level-suggestions">
                {LEVEL_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </label>
          </div>

          <fieldset className="import-settings">
            <legend>How much should Lerno generate?</legend>
            <div className="import-settings-row">
              <span className="import-settings-label">Flashcards</span>
              {COUNT_OPTIONS.map((count) => (
                <button
                  key={`cards-${count}`}
                  type="button"
                  className={`import-chip${settings.flashcards === count ? ' import-chip-active' : ''}`}
                  aria-pressed={settings.flashcards === count}
                  onClick={() => setSettings((current) => ({ ...current, flashcards: count }))}
                >
                  {count}
                </button>
              ))}
            </div>
            <div className="import-settings-row">
              <span className="import-settings-label">Practice questions</span>
              {COUNT_OPTIONS.map((count) => (
                <button
                  key={`practice-${count}`}
                  type="button"
                  className={`import-chip${settings.practice === count ? ' import-chip-active' : ''}`}
                  aria-pressed={settings.practice === count}
                  onClick={() => setSettings((current) => ({ ...current, practice: count }))}
                >
                  {count}
                </button>
              ))}
            </div>
            <div className="import-settings-row">
              <span className="import-settings-label">Difficulty</span>
              {(
                [
                  ['easy', 'Easy'],
                  ['medium', 'Medium'],
                  ['hard', 'Hard'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`import-chip${settings.difficulty === value ? ' import-chip-active' : ''}`}
                  aria-pressed={settings.difficulty === value}
                  onClick={() => setSettings((current) => ({ ...current, difficulty: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="import-settings-row">
              <span className="import-settings-label">Language</span>
              {(
                [
                  ['nl', 'Nederlands'],
                  ['en', 'English'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`import-chip${settings.language === value ? ' import-chip-active' : ''}`}
                  aria-pressed={settings.language === value}
                  onClick={() => setSettings((current) => ({ ...current, language: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {error ? (
            <p className="import-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="import-actions">
            <Button onClick={() => void create(false)} disabled={!canCreate}>
              {busy ? 'Creating your study pack…' : 'Create Study Pack'}
            </Button>
            <span className="muted import-actions-note">
              Lerno reads your material, finds the concepts and builds summaries, flashcards and
              practice. Nothing is generated until you press this button.
            </span>
          </div>
        </section>
      ) : null}

      {subjectsLoading ? <LoadingRow /> : null}

      <p className="muted import-footnote">
        You keep control: Lerno never overwrites your own cards, and generated content stays
        editable. Prefer working from an AI Studio source? <Link to="/ai/studio">Open AI Studio</Link>
        <IconArrowRight size={14} />
      </p>
    </div>
  );
}

function OptionCard({
  title,
  description,
  Icon,
  active,
  onClick,
}: {
  title: string;
  description: string;
  Icon: ComponentType<{ size?: number }>;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`import-option${active ? ' import-option-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="import-option-icon">
        <Icon size={19} />
      </span>
      <span className="import-option-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}
