import { normalizeHistory, capLength, type NormalizedMessage } from './ai-sanitize.js';
import type { AiContextSource } from './ai-context-source.js';
import { MAX_HISTORY_MESSAGES_ACCEPTED } from './ai-limits.js';

/** Sent history is much smaller than the accepted API payload. */
export const CHAT_HISTORY_CHARS = 3200;
const EXPLICIT_MATERIAL_INTRO =
  /\b(?:hier (?:zijn|is)|dit zijn|dit is mijn|the topics are|here (?:are|is)|these are|my (?:notes|flashcards|study material))\b/i;
const TOPIC_DECLARATION =
  /\b(?:onderwerpen|begrippen|toetsstof|examenstof|leerstof|topics|terms|study material)\b\s*(?:zijn|is|:|=|are|include)\b/i;
const CHAPTER_CONTENT =
  /\b(?:hoofdstuk|chapter|paragraaf|section)\s+[\w.-]+\s+(?:gaat over|behandelt|bevat|is about|covers|contains)\b/i;
const CHAPTER_LIST =
  /\b(?:hoofdstuk|chapter|paragraaf|section)\s+[\w.-]+[^\n:]{0,30}:\s*(?:[-*•]|\d+[.)])\s*\S/im;
const CARD_QA_LABEL = /\b(?:flashcards?|kaarten|cards?)\b/i;
const CARD_QA_CONTENT = /\b(?:vraag|question)\s*[:?][\s\S]*\b(?:antwoord|answer)\s*:/i;
const LEVEL =
  /\b(?:mavo|havo|vwo|vmbo(?:[ -](?:tl|gl|kb|bb))?|mbo|hbo|university|universitair)(?:[ -]*(?:klas|leerjaar|year)?[ -]*[1-6])?\b/gi;
const STOP = new Set(
  'de het een en van op in is wat hoe waarom geef vraag vragen leg uit over voor met aan dit dat mij je ik kun kan welke moeilijk moeilijke easy hard explain what why the a an of on in for and to'.split(
    ' ',
  ),
);
function terms(text: string): Set<string> {
  return new Set(
    (
      text
        .replace(LEVEL, '')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((w) => w.length > 2 && !STOP.has(w)),
  );
}
function overlap(a: Set<string>, text: string): boolean {
  return [...terms(text)].some((w) => a.has(w));
}

/**
 * Mark chat as a source only when the student explicitly supplies notes, topics,
 * chapter content or Q/A cards. Assistant-generated text is never a source.
 */
function hasExplicitStudyMaterial(text: string): boolean {
  return (
    EXPLICIT_MATERIAL_INTRO.test(text) ||
    TOPIC_DECLARATION.test(text) ||
    CHAPTER_CONTENT.test(text) ||
    CHAPTER_LIST.test(text) ||
    (CARD_QA_LABEL.test(text) && CARD_QA_CONTENT.test(text)) ||
    (text.length >= 240 &&
      /[.!?].*[.!?]/s.test(text) &&
      !/\b(?:wat moet ik leren|what should i learn)\b/i.test(text))
  );
}

/** Classifies only supplied student text; absence of a set/card/document is `none`. */
export function chatContextSource(
  message: string,
  history: ReadonlyArray<Pick<NormalizedMessage, 'role' | 'content'>>,
): AiContextSource {
  return [
    message,
    ...history.filter((entry) => entry.role === 'user').map((entry) => entry.content),
  ].some(hasExplicitStudyMaterial)
    ? 'chat'
    : 'none';
}

/** Extractive context, not a model-generated summary. Bounded linear string work.
 * Keep complete user/assistant groups; select older groups only by lexical overlap.
 * Short/elliptical follow-ups retain the latest group even without overlap.
 * Only user text supplies a persistent level; never promote assistant claims to system instructions.
 */
export function selectChatContext(
  message: string,
  history: unknown,
): { messages: NormalizedMessage[]; level: string | null } {
  const normalized = normalizeHistory(
    Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES_ACCEPTED) : [],
    {
      maxMessages: MAX_HISTORY_MESSAGES_ACCEPTED,
      maxItemChars: 8000,
      maxTotalChars: 48_000,
    },
  ).messages;
  let level: string | null = null;
  for (const entry of normalized) {
    if (entry.role === 'user') level = statedLevel(entry.content) ?? level;
  }
  // The current request already carries its level; avoid repeating it in system content.
  if (statedLevel(message)) level = null;
  const groups: NormalizedMessage[][] = [];
  for (const entry of normalized) {
    if (entry.role === 'user') groups.push([entry]);
    else {
      const group = groups.at(-1);
      if (group) group.splice(1, group.length, entry);
    }
  }
  const query = terms(message);
  const followUp =
    /^(?:en\b|and\b|maar\b|but\b|waarom\s*\??$|why\s*\??$|ja\b|nee\b|yes\b|no\b)|\b(?:dat|dit|die|deze|daar|vorige|bovenstaande|hetzelfde|nog een|hint|it|that|previous|again)\b/i.test(
      message,
    ) ||
    (!/^(?:hallo|hoi|hello|hi)\b/i.test(message) &&
      message.trim().split(/\s+/).length <= 3 &&
      !/^(?:wat|what|leg|explain|beschrijf|describe|bereken|calculate)\b/i.test(message));
  const studyPlanningFollowUp =
    /\b(?:help|overhoor|quiz|plan|oefen|study|test)\b[\s\S]{0,80}\b(?:leren|study|morgen|toets|exam|tomorrow)\b/i.test(
      message,
    );
  const selected: NormalizedMessage[][] = [];
  let remaining = CHAT_HISTORY_CHARS;
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]!;
    const suppliedStudyMaterial =
      studyPlanningFollowUp &&
      group.some((entry) => entry.role === 'user' && hasExplicitStudyMaterial(entry.content));
    if (
      !(followUp && i === groups.length - 1) &&
      !suppliedStudyMaterial &&
      !group.some((m) => overlap(query, m.content))
    )
      continue;
    // Keep both the start (definition) and end (last question/conclusion) of long answers.
    const compact = group.map((m) => ({
      ...m,
      content: excerpt(m.content, m.role === 'assistant' ? 1000 : 600),
    }));
    const size = compact.reduce((n, m) => n + m.content.length, 0);
    if (size > remaining) continue;
    selected.unshift(compact);
    remaining -= size;
    if (selected.length === 2) break;
  }
  return { messages: selected.flat(), level };
}

/** Ignore simple explicit negations; do not infer curriculum from model replies. */
function statedLevel(text: string): string | null {
  let level: string | null = null;
  for (const match of text.matchAll(LEVEL)) {
    const prefix = text.slice(Math.max(0, match.index! - 30), match.index);
    if (/\b(?:niet|geen|not|no|never|zonder)\s*(?:op\s+)?$/i.test(prefix)) continue;
    level = match[0].toLowerCase().replace(/\s+/g, ' ');
  }
  return level;
}

function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const tail = Math.floor(limit / 3);
  return capLength(text, limit - tail - 1) + '\n' + text.slice(-tail);
}

/**
 * The one compact level line added to the system prompt: ` Level: mavo 3.`
 *
 * Six words instead of a paragraph about what mavo 3 means. The level is only
 * repeated here when the current message does not state it itself, and it is
 * never derived from the difficulty of a question — "hard" stays inside the
 * level the student is in.
 */
export function levelDirective(level: string | null): string {
  return level ? ` Level: ${level}.` : '';
}

/** These are ceilings, not target lengths. Unknown requests keep explanation room. */
export function chatOutputBudget(message: string): number {
  if (/^\s*(?:hallo|hoi|hey|hello|hi|bedankt|thanks)[!.\s]*$/i.test(message)) return 96;
  if (
    /\b(?:uitgebreid|complexe?|diepgaand|alles over|detailed|in detail|bewijs|prove)\b/i.test(
      message,
    )
  )
    return 1800;
  if (/\b(?:hint|aanwijzing)\b/i.test(message)) return 160;
  if (
    /(?:\b(?:een|one)|één)\s+(?:(?:moeilijke|makkelijke|hard|easy)\s+)?(?:oefen)?(?:vraag|question)\b/i.test(
      message,
    )
  )
    return 280;
  if (
    /^\s*(?:wat is|what is)\s+[\d\s.,%+×*/()−-]+(?:van|of)?[\d\s.,%+×*/()−-]*\??\s*$/i.test(message)
  )
    return 200;
  if (
    message.length < 100 &&
    /^(?:wat is|waarom is|hoeveel|what is|why is)\b/i.test(message.trim())
  )
    return 320;
  return 800;
}
