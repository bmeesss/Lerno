/** Offline size/CPU audit; --live additionally calls the configured Groq model.
 * Logs only numerical metrics, case IDs and boolean checks, never content/secrets.
 * Run from root: npx tsx backend/scripts/measure-ai.ts [--live]
 *
 * Live mode streams the five canonical school questions and reports, per request:
 * input/output/reasoning tokens, TTFT, total latency, answer length and smoke
 * checks — exactly the fields needed to compare two configurations.
 */
import { performance } from 'node:perf_hooks';
import { getEncoding } from 'js-tiktoken';
import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions.js';
import { buildChatRequest, buildConversation, guardReply } from '../src/services/ai-service.js';
import { AI_TASKS } from '../src/services/ai-prompts.js';
import {
  buildChatParams,
  getGroqClient,
  requestChat,
  requireGroqKey,
  type ChatRequest,
} from '../src/services/ai-completion.js';
import { cleanAiText } from '../src/lib/ai-text.js';
import { config } from '../src/config.js';
import type { AiChatMessage } from '../src/validators/ai.validators.js';

const live = process.argv.includes('--live');
if (live && !config.groqApiKey) {
  console.error('Live audit unavailable: GROQ_API_KEY is not configured. No provider calls made.');
  process.exit(1);
}
const encoder = getEncoding('o200k_base');
const count = (text: string) => encoder.encode(text).length;
const history: AiChatMessage[] = [
  { role: 'user', content: 'Wat is massa? Ik zit in mavo 3.' },
  {
    role: 'assistant',
    content: 'Massa is de hoeveelheid materie in een voorwerp. Je meet massa in kilogram.',
  },
];
const long: AiChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user',
  content: (i % 2
    ? 'Massa meet je in kilogram; gewicht is een kracht. '
    : 'Leg massa en gewicht uit op mavo 3. '
  ).repeat(30),
}));
const cases = [
  { id: 'greeting', message: 'Hallo', history: [] },
  { id: 'arithmetic', message: 'Wat is 15% van 240?', history: [] },
  { id: 'mavo-explanation', message: 'Leg fotosynthese uit op mavo 3-niveau.', history: [] },
  {
    id: 'hard-mavo',
    message: 'Geef een moeilijke vraag over massa en gewicht op mavo 3.',
    history: [],
  },
  { id: 'moon', message: 'Waarom is gewicht op de maan kleiner?', history: [] },
  { id: 'follow-up', message: 'En gewicht?', history },
  { id: 'long-chat', message: 'En gewicht op de maan?', history: long },
  { id: 'independent', message: 'Wat is 15% van 240?', history: long },
] satisfies { id: string; message: string; history: AiChatMessage[] }[];

/** The five prompts from the live test plan, in order. */
const qualityPrompts = [
  { id: 'mavo-explanation', prompt: 'Leg fotosynthese uit op mavo 3-niveau.' },
  { id: 'moon', prompt: 'Waarom is mijn gewicht op de maan kleiner?' },
  { id: 'hard-mavo', prompt: 'Geef één moeilijke vraag over massa en gewicht op mavo 3.' },
  { id: 'equation', prompt: 'Los 3x + 7 = 22 stap voor stap op.' },
  { id: 'history-explanation', prompt: 'Leg de Franse Revolutie kort uit op mavo 3-niveau.' },
] as const;

type StreamParams = Omit<ChatCompletionCreateParamsNonStreaming, 'stream'> & { stream: true };

/**
 * One streamed completion, so time-to-first-token is measurable. Production
 * answers in one non-streamed call; only this audit script streams.
 */
async function streamChat(request: ChatRequest) {
  const params: StreamParams = { ...buildChatParams(request), stream: true };
  const startedAt = performance.now();
  const stream = await getGroqClient(requireGroqKey()).chat.completions.create({
    ...params,
    stream_options: { include_usage: true },
  } as StreamParams);
  let ttftMs: number | null = null;
  let text = '';
  let usage: Record<string, unknown> | null = null;
  for await (const chunk of stream) {
    if (ttftMs === null) ttftMs = performance.now() - startedAt;
    const raw = chunk as unknown as {
      choices?: { delta?: { content?: string | null } }[];
      usage?: Record<string, unknown> | null;
      x_groq?: { usage?: Record<string, unknown> | null };
    };
    text += raw.choices?.[0]?.delta?.content ?? '';
    usage = raw.usage ?? raw.x_groq?.usage ?? usage;
  }
  const details = (usage?.completion_tokens_details ?? {}) as { reasoning_tokens?: number };
  return {
    text,
    ttftMs,
    durationMs: performance.now() - startedAt,
    inputTokens: (usage?.prompt_tokens as number | undefined) ?? null,
    outputTokens: (usage?.completion_tokens as number | undefined) ?? null,
    reasoningTokens: details.reasoning_tokens ?? null,
    totalTokens: (usage?.total_tokens as number | undefined) ?? null,
  };
}

/** Coarse smoke checks, not a substitute for curriculum/content review. */
function smokeChecks(id: string, text: string): Record<string, boolean> {
  return {
    nonempty: text.length > 0,
    noLeak: guardReply(text) === text,
    arithmetic: !['arithmetic', 'independent', 'equation'].includes(id) || /5\b|\b15\b/.test(text),
    noAdvancedGravity:
      !['moon', 'hard-mavo', 'long-chat'].includes(id) ||
      !/GM|universitair|differentiaal|newton/i.test(text),
    conciseGreeting: id !== 'greeting' || text.split(/\s+/).length <= 30,
    questionWithoutAnswer: id !== 'hard-mavo' || !/\b(?:antwoord|answer)\s*:/i.test(text),
  };
}

console.info(
  JSON.stringify({
    tokenizer: 'o200k_base (content proxy, not provider template)',
    model: config.groqModel,
    reasoningEffort: config.groqReasoningEffort,
    taskPromptTokens: Object.fromEntries(
      Object.entries(AI_TASKS).map(([name, task]) => [name, count(task.system)]),
    ),
    taskReasoning: Object.fromEntries(
      Object.entries(AI_TASKS).map(([name, task]) => [name, task.reasoning]),
    ),
  }),
);
for (const example of cases) {
  const request = buildChatRequest(example.message, example.history);
  const messages = request.messages;
  const metrics = {
    id: example.id,
    systemTokens: count(messages[0]!.content),
    historyTokens: messages.slice(1, -1).reduce((n, m) => n + count(m.content), 0),
    userTokens: count(messages.at(-1)!.content),
    messages: messages.length,
    serializedMessageChars: JSON.stringify(messages).length,
    reasoningEffort: request.reasoningEffort,
    completionCeiling: buildChatParams(request).max_completion_tokens,
  };
  if (!live) {
    console.info(JSON.stringify(metrics));
    continue;
  }
  // For a real same-chat follow-up, first obtain the preceding model response.
  if (example.id === 'follow-up') {
    const previous = await requestChat(buildChatRequest(history[0]!.content, []));
    const messages = buildChatRequest(example.message, [
      history[0]!,
      { role: 'assistant', content: cleanAiText(guardReply(previous.text)) },
    ]);
    metrics.historyTokens = messages.messages
      .slice(1, -1)
      .reduce((n, m) => n + count(m.content), 0);
    metrics.serializedMessageChars = JSON.stringify(messages.messages).length;
    metrics.completionCeiling = buildChatParams(messages).max_completion_tokens;
  }
  const result = await requestChat(request);
  const text = cleanAiText(guardReply(result.text));
  const checks = smokeChecks(example.id, text);
  console.info(
    JSON.stringify({
      ...metrics,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      durationMs: result.durationMs,
      answerWords: text.split(/\s+/).length,
      checks,
    }),
  );
  if (Object.values(checks).some((ok) => !ok)) process.exitCode = 1;
}

// The live test plan: five real school questions, one request each.
for (const [index, { id, prompt }] of qualityPrompts.entries()) {
  const request = buildChatRequest(prompt, []);
  const info = {
    id: `plan-${index + 1}-${id}`,
    promptChars: prompt.length,
    contentTokens: request.messages.reduce((n, m) => n + count(m.content), 0),
    outputBudget: request.maxOutputTokens,
    reasoningEffort: request.reasoningEffort,
  };
  if (!live) {
    console.info(JSON.stringify(info));
    continue;
  }
  const result = await streamChat(request);
  const text = cleanAiText(guardReply(result.text));
  const checks = smokeChecks(id, text);
  console.info(
    JSON.stringify({
      ...info,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      totalTokens: result.totalTokens,
      ttftMs: Math.round(result.ttftMs ?? 0),
      totalMs: Math.round(result.durationMs),
      answerWords: text.split(/\s+/).length,
      // The level only travels in the system prompt when it came from history;
      // here the student states it in the question itself.
      levelInSystemPrompt: /Level: mavo 3/i.test(request.messages[0]!.content),
      checks,
    }),
  );
  if (Object.values(checks).some((ok) => !ok)) process.exitCode = 1;
}

global.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
const start = performance.now();
for (let i = 0; i < 1000; i++) buildConversation('En gewicht op de maan?', long);
const msPerLongHistory = (performance.now() - start) / 1000;
global.gc?.();
console.info(
  JSON.stringify({
    benchmarkIterations: 1000,
    msPerLongHistory,
    retainedHeapDeltaBytes: global.gc ? process.memoryUsage().heapUsed - heapBefore : null,
  }),
);
