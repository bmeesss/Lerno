/**
 * AI analysis of normalized sources.
 *
 * One analysis per Study Pack, grounded in the material: summary, key facts,
 * relationships, likely exam topics, difficulty, sections and — when two sources
 * disagree — an explicit conflict instead of a silently merged "fact".
 *
 * Two rules make this trustworthy:
 *  1. provenance is verified, never trusted: a reference marker the model
 *     invented is dropped, so a student can never be shown a page that does not
 *     contain the claim;
 *  2. a conflict only survives if at least two claims point at *different*
 *     sources and each claim quotes text that really appears there.
 */
import type { NormalizedSource, SourceContext } from './source-normalize.js';
import { buildSourceContext, resolveMarker } from './source-normalize.js';
import {
  generatedConceptsSchema,
  generatedSourceAnalysisSchema,
  type GeneratedSourceAnalysis,
} from '../lib/ai-schemas.js';
import type { MaterialDifficulty, PackAnalysis, SourceConflict } from '../lib/source-model.js';
import { runStructuredAiTask } from './ai-tasks.js';
import { normalizeForComparison, reviewConcepts, type RejectedItem } from './content-quality.js';
import type { GenerationLanguage } from '../lib/source-model.js';

/** Character budget for the analysis context (whole material, bounded). */
export const ANALYSIS_MAX_CONTEXT_CHARS = 18_000;

export interface AnalyzedConcept {
  name: string;
  explanation: string;
  sourceId: string;
  refLabel: string | null;
  importance: number | null;
  difficulty: MaterialDifficulty | null;
}

export interface SourceAnalysisResult {
  analysis: PackAnalysis;
  concepts: AnalyzedConcept[];
  /** Items dropped by the deterministic quality pass. */
  rejected: RejectedItem[];
  context: SourceContext;
}

/**
 * Resolves where a generated item belongs. A verified marker wins; without one
 * Lerno only attributes the item when the material has exactly one source, and
 * otherwise leaves it unattributed so the quality pass can drop it.
 */
export function resolveItemSource(
  context: SourceContext,
  marker: string | null | undefined,
  usedSourceIds: string[],
): { sourceId: string | null; refLabel: string | null } {
  const entry = resolveMarker(context, marker);
  if (entry) {
    // A source-level token ("1:x1") is real provenance for the source as a
    // whole — the notes themselves — so it has no inner reference to show.
    return {
      sourceId: entry.sourceId,
      refLabel: entry.reference.kind === 'none' ? null : entry.reference.label,
    };
  }
  if (usedSourceIds.length === 1) return { sourceId: usedSourceIds[0]!, refLabel: null };
  return { sourceId: null, refLabel: null };
}

/** A quote really inside the referenced source text (whitespace-insensitive). */
export function quoteIsGrounded(
  sources: NormalizedSource[],
  sourceId: string,
  quote: string,
): boolean {
  const source = sources.find((entry) => entry.sourceId === sourceId);
  if (!source) return false;
  const haystack = normalizeForComparison(source.text);
  const needle = normalizeForComparison(quote);
  if (needle.length < 5) return false;
  return haystack.includes(needle);
}

/** Keeps only source-grounded, cross-source conflicts. */
export function verifyConflicts(
  conflicts: GeneratedSourceAnalysis['conflicts'],
  sources: NormalizedSource[],
  context: SourceContext,
): SourceConflict[] {
  const verified: SourceConflict[] = [];
  for (const conflict of conflicts) {
    const claims: SourceConflict['claims'] = [];
    for (const claim of conflict.claims) {
      const entry = resolveMarker(context, claim.ref);
      if (!entry) continue;
      if (!quoteIsGrounded(sources, entry.sourceId, claim.quote)) continue;
      if (claims.some((existing) => existing.sourceId === entry.sourceId)) continue;
      claims.push({
        statement: claim.statement,
        sourceId: entry.sourceId,
        marker: entry.reference.marker,
        referenceLabel: entry.reference.label,
        quote: claim.quote,
      });
    }
    if (claims.length < 2) continue;
    verified.push({ topic: conflict.topic, explanation: conflict.explanation, claims });
  }
  return verified;
}

export interface AnalyzeSourcesOptions {
  language: GenerationLanguage;
  difficulty: MaterialDifficulty | null;
  /** Concepts already in the pack — never duplicated by a new analysis. */
  existingConceptNames?: string[];
  maxContextChars?: number;
}

/**
 * Analyzes the sources and the concepts in one pass each. Throws the normal AI
 * errors (unavailable/timeout/invalid) so the pipeline can mark the stage failed
 * honestly and let the student retry.
 */
export async function analyzeSources(
  sources: NormalizedSource[],
  options: AnalyzeSourcesOptions,
): Promise<SourceAnalysisResult> {
  const context = buildSourceContext(sources, {
    maxChars: options.maxContextChars ?? ANALYSIS_MAX_CONTEXT_CHARS,
  });
  // `task` is a label for the model and for logs/tests; it never carries data.
  const request = {
    task: 'analysis',
    language: options.language,
    difficulty: options.difficulty ?? 'medium',
  };

  const { data: rawAnalysis } = await runStructuredAiTask({
    task: 'source-analysis',
    payload: JSON.stringify({ material: context.text, request }),
    schema: generatedSourceAnalysisSchema,
    contextSource: 'source',
    logMeta: {
      sourceCount: context.usedSourceIds.length,
      sourceChars: context.characters,
      language: options.language,
    },
  });

  const { data: rawConcepts } = await runStructuredAiTask({
    task: 'source-concepts',
    payload: JSON.stringify({
      material: context.text,
      request: { ...request, task: 'concepts', count: 20 },
    }),
    schema: generatedConceptsSchema,
    contextSource: 'source',
    logMeta: {
      sourceCount: context.usedSourceIds.length,
      language: options.language,
    },
  });

  const candidateConcepts: (AnalyzedConcept & { __ok: boolean })[] = [];
  const rejected: RejectedItem[] = [];
  rawConcepts.concepts.forEach((concept, index) => {
    const resolved = resolveItemSource(context, concept.ref, context.usedSourceIds);
    candidateConcepts.push({
      name: concept.name,
      explanation: concept.explanation,
      sourceId: resolved.sourceId ?? '',
      refLabel: resolved.refLabel,
      importance: concept.importance ?? null,
      difficulty: (concept.difficulty as MaterialDifficulty | undefined) ?? null,
      __ok: resolved.sourceId !== null,
    });
    if (!resolved.sourceId) {
      rejected.push({
        kind: 'concept',
        index,
        reason: 'missing_source_reference',
        detail: `"${concept.name}" could not be linked to one of your sources.`,
      });
    }
  });

  const review = reviewConcepts(
    candidateConcepts
      .filter((concept) => concept.__ok)
      .map((concept) => ({
        name: concept.name,
        explanation: concept.explanation,
        refLabel: concept.refLabel,
        sourceId: concept.sourceId,
      })),
    { names: options.existingConceptNames ?? [] },
  );

  const concepts: AnalyzedConcept[] = review.accepted.map((concept) => {
    const original = candidateConcepts.find((entry) => entry.name === concept.name)!;
    return {
      name: concept.name,
      explanation: concept.explanation,
      sourceId: concept.sourceId!,
      refLabel: concept.refLabel,
      importance: original.importance,
      difficulty: original.difficulty,
    };
  });

  const conflicts = verifyConflicts(rawAnalysis.conflicts, sources, context);

  const analysis: PackAnalysis = {
    summary: rawAnalysis.summary,
    keyFacts: rawAnalysis.keyFacts,
    relationships: rawAnalysis.relationships,
    examTopics: rawAnalysis.examTopics,
    difficulty: rawAnalysis.difficulty as MaterialDifficulty,
    sections: rawAnalysis.sections.map((section) => {
      const resolved = resolveMarker(context, section.ref);
      return {
        title: section.title,
        marker: resolved ? resolved.reference.marker : '',
      };
    }),
    conflicts,
    sourceIds: context.usedSourceIds,
    createdAt: new Date().toISOString(),
  };

  return { analysis, concepts, rejected: [...rejected, ...review.rejected], context };
}
