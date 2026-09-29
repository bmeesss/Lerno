-- Source expansion — the AI content engine's normalized source layer.
--
-- Additive and backwards compatible:
--   1. Every Study Pack source can carry its extraction provenance (`metadata`)
--      and the pipeline stage it is at (`processing_stage`).
--   2. The source status set gains `pending` (uploaded, not processed yet).
--      Existing rows keep their current status; nothing is rewritten.
--   3. Concepts can point at the exact place in a source they came from
--      (`ref_label`), carry importance/difficulty, and flag a conflict.
--   4. A Study Pack stores the source-grounded analysis it was generated from,
--      so every generated item is reproducible from the same analysis.
--
-- No table is renamed, dropped or rewritten; Study Packs from before this
-- migration keep working exactly as they did.

-- study_pack_sources ---------------------------------------------------------

alter table public.study_pack_sources
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists processing_stage text;

alter table public.study_pack_sources
  drop constraint if exists study_pack_sources_status_check;

alter table public.study_pack_sources
  add constraint study_pack_sources_status_check
  check (status in ('pending', 'uploading', 'processing', 'ready', 'failed'));

alter table public.study_pack_sources
  drop constraint if exists study_pack_sources_processing_stage_check;

alter table public.study_pack_sources
  add constraint study_pack_sources_processing_stage_check
  check (
    processing_stage is null
    or processing_stage in ('upload', 'extract', 'normalize', 'analyze', 'generate', 'review')
  );

comment on column public.study_pack_sources.metadata is
  'Extraction provenance: language, references (page/slide/timestamp), method, warnings. Never model output.';

-- concepts -------------------------------------------------------------------

alter table public.concepts
  add column if not exists ref_label text,
  add column if not exists importance numeric,
  add column if not exists difficulty text,
  add column if not exists conflict_with text;

alter table public.concepts
  drop constraint if exists concepts_difficulty_check;

alter table public.concepts
  add constraint concepts_difficulty_check
  check (difficulty is null or difficulty in ('easy', 'medium', 'hard'));

comment on column public.concepts.ref_label is
  'Provenance inside the source, e.g. "page 6" or "slide 8"; shown to the student.';

-- study_packs ----------------------------------------------------------------

alter table public.study_packs
  add column if not exists analysis jsonb,
  add column if not exists analysis_updated_at timestamptz;

comment on column public.study_packs.analysis is
  'Source-grounded analysis (summary, key facts, exam topics, difficulty, conflicts) reused by every generation.';
