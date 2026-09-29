import { useMemo, useRef, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Badge, LoadingRow } from '../../components/ui/Primitives';
import {
  IconAlert,
  IconArrowRight,
  IconAudio,
  IconBook,
  IconFile,
  IconImage,
  IconLayers,
  IconSparkles,
  IconUpload,
  IconVideo,
} from '../../components/ui/Icons';
import { ImportProcessing } from '../../components/study-pack/ImportProcessing';
import { useToast } from '../../components/ui/Toast';
import { useAsync } from '../../hooks/useAsync';
import { ApiError } from '../../lib/api';
import { studyPackImportService } from '../../services/studyPackImportService';
import { studySetService } from '../../services/studySetService';
import { subjectService } from '../../services/subjectService';
import type { DuplicateMaterialRef, ImportProcessingStatus, MaterialPdfPreview } from '../../types';

type Mode = 'text' | 'pdf' | 'set';

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

/** Accepted-by-browser hint; the backend validates the real type and content. */
const PDF_ACCEPT = 'application/pdf,.pdf';

function materialStateLabel(phase: 'uploading' | 'reading', progress: number): string {
  if (phase === 'uploading') {
    return progress > 0 && progress < 100
      ? `Uploading your file… ${progress}%`
      : 'Uploading your file…';
  }
  return 'Reading your PDF…';
}

/**
 * "Add study material" — the one place where a student brings material in.
 *
 * Everything the student sees here is real: the PDF preview comes from a
 * server-side read of the actual file, the concept candidates are found in that
 * text, and the processing screen reports the stages the backend really runs.
 * Options without an adapter are shown as coming soon instead of pretending.
 */
export function NewStudyPackPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: subjects, loading: subjectsLoading } = useAsync(
    () => subjectService.list(),
    [],
  );
  const { data: mySets } = useAsync(() => studySetService.listMine(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>('text');
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [level, setLevel] = useState('');
  const [text, setText] = useState('');
  const [setId, setSetId] = useState('');
  const [pdf, setPdf] = useState<{ preview: MaterialPdfPreview; fileName: string } | null>(null);
  const [upload, setUpload] = useState<{ phase: 'idle' | 'uploading' | 'reading'; progress: number }>(
    { phase: 'idle', progress: 0 },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<(DuplicateMaterialRef & { raw: string }) | null>(null);
  const [started, setStarted] = useState<{ packId: string; status: ImportProcessingStatus } | null>(
    null,
  );

  const wordCount = useMemo(
    () => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length,
    [text],
  );
  const readableChars = text.replace(/\s/g, '').length;
  const pickedSet = (mySets ?? []).find((set) => set.id === setId) ?? null;

  const canCreate =
    mode === 'set'
      ? Boolean(setId) && title.trim().length > 0
      : mode === 'pdf'
        ? Boolean(pdf) && title.trim().length > 0 && !busy
        : readableChars >= MIN_TEXT_CHARS && title.trim().length > 0 && !busy;

  function selectMode(next: Mode) {
    setMode(next);
    setError(null);
    setDuplicate(null);
    if (next === 'pdf' && !pdf) setTitle('');
  }

  async function choosePdf(file: File) {
    setError(null);
    setDuplicate(null);
    setPdf(null);
    setUpload({ phase: 'uploading', progress: 0 });
    try {
      const preview = await studyPackImportService.previewPdf(file, {
        onProgress: (percent) => setUpload({ phase: 'uploading', progress: percent }),
      });
      setUpload({ phase: 'reading', progress: 100 });
      setPdf({ preview, fileName: file.name });
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

  async function create(allowDuplicate = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await studyPackImportService.create({
        title: title.trim() || pdf?.preview.title || pickedSet?.title || 'Study pack',
        subjectId: subjectId || null,
        level: level.trim(),
        allowDuplicate,
        source:
          mode === 'set'
            ? { type: 'set', setId, title: pickedSet?.title ?? 'Existing Lerno set' }
            : mode === 'pdf' && pdf
              ? {
                  type: 'pdf',
                  title: pdf.fileName,
                  text: pdf.preview.text,
                  pageCount: pdf.preview.pageCount,
                }
              : { type: 'text', title: title.trim() || 'Pasted notes', text },
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
   * A finished import opens the Study Pack — the student should never end on an
   * empty page. A partial or failed run stays on this screen so the failure and
   * its "Try again" are visible first, and an import without AI stays just long
   * enough to explain why the pack has no generated content yet.
   */
  function finish(status: ImportProcessingStatus) {
    if (status.status === 'ready' && !status.aiSkipped) {
      navigate(`/study-packs/${status.packId}`, { replace: true });
    }
  }

  if (started) {
    return (
      <div className="import-page">
        <header className="import-hero">
          <span className="eyebrow-label">Add study material</span>
          <h1>Lerno is building your study pack</h1>
          <p>
            You can leave this page whenever you want: your material is saved and the study pack is
            already in My Study.
          </p>
        </header>
        <ImportProcessing
          packId={started.packId}
          initialStatus={started.status}
          onFinished={finish}
          onOpenPack={() => navigate(`/study-packs/${started.packId}`)}
        />
      </div>
    );
  }

  return (
    <div className="import-page">
      <header className="import-hero">
        <span className="eyebrow-label">Add study material</span>
        <h1>Turn your material into a study pack</h1>
        <p>
          Upload notes, a PDF, or paste your material. Lerno will organize it into summaries,
          concepts, flashcards and practice.
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
              <OptionCard
                title="PDF"
                description="A chapter, summary or reader with selectable text."
                Icon={IconFile}
                active={mode === 'pdf'}
                onClick={() => selectMode('pdf')}
              />
              <OptionCard
                title="PowerPoint"
                description="Slides from a lesson."
                Icon={IconLayers}
                comingSoon
              />
              <OptionCard
                title="Image"
                description="A photo of your notes."
                Icon={IconImage}
                comingSoon
              />
              <OptionCard title="Audio" description="A recorded lesson." Icon={IconAudio} comingSoon />
            </div>
          </div>

          <div className="import-group">
            <span className="import-group-label">Import</span>
            <div className="import-options">
              <OptionCard
                title="Existing Lerno set"
                description="Turn a set you already have into a study pack."
                Icon={IconBook}
                active={mode === 'set'}
                onClick={() => selectMode('set')}
              />
              <OptionCard
                title="YouTube"
                description="A video lesson."
                Icon={IconVideo}
                comingSoon
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
              <OptionCard
                title="Write notes"
                description="Type it straight into Lerno."
                Icon={IconSparkles}
                active={mode === 'text'}
                onClick={() => selectMode('text')}
              />
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="import-error" role="alert">
          <IconAlert size={18} />
          <div>
            <strong>We couldn&apos;t use this material</strong>
            <p>{error}</p>
          </div>
          {mode === 'pdf' ? (
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              Choose another file
            </Button>
          ) : null}
        </div>
      ) : null}

      {duplicate ? (
        <section className="card import-duplicate" aria-labelledby="import-duplicate-heading">
          <span className="eyebrow-label">Already in your library</span>
          <h2 id="import-duplicate-heading">This material may already exist</h2>
          <p className="muted">
            You imported “{duplicate.sourceTitle}” before, in “{duplicate.packTitle}”. Open that study
            pack or add this material anyway.
          </p>
          <div className="import-actions">
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
                Selectable text only. Scanned pages without text cannot be read yet — paste the text
                instead.
              </p>
            </div>
          </div>

          {!pdf ? (
            <label className="import-drop">
              <IconUpload size={22} />
              <strong>Choose a PDF from your device</strong>
              <small>Up to 15 MB and 100 pages.</small>
              <input
                ref={fileInputRef}
                type="file"
                accept={PDF_ACCEPT}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void choosePdf(file);
                }}
              />
              {upload.phase !== 'idle' ? (
                <span className="import-upload-status" role="status">
                  {materialStateLabel(upload.phase, upload.progress)}
                </span>
              ) : null}
            </label>
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

          <div className="import-actions">
            <Button onClick={() => void create(false)} disabled={!canCreate || busy}>
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
  comingSoon,
  onClick,
}: {
  title: string;
  description: string;
  Icon: ComponentType<{ size?: number }>;
  active?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
}) {
  if (comingSoon) {
    return (
      <div className="import-option import-option-disabled" aria-disabled="true">
        <span className="import-option-icon">
          <Icon size={19} />
        </span>
        <span className="import-option-copy">
          <strong>
            {title} <Badge>Coming soon</Badge>
          </strong>
          <small>{description}</small>
        </span>
      </div>
    );
  }
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
