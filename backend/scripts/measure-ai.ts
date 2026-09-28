/** Offline size/CPU audit; --live additionally calls the configured Groq model.
 * Logs only numerical metrics, case IDs and boolean checks, never content/secrets.
 * Run from root: npx tsx backend/scripts/measure-ai.ts [--live]
 */
import { performance } from 'node:perf_hooks';
import { getEncoding } from 'js-tiktoken';
import { buildConversation, guardReply } from '../src/services/ai-service.js';
import { AI_TASKS } from '../src/services/ai-prompts.js';
import { requestChat, completionBudget } from '../src/services/ai-completion.js';
import { chatOutputBudget } from '../src/lib/ai-chat-context.js';
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
console.info(
  JSON.stringify({
    tokenizer: 'o200k_base (content proxy, not provider template)',
    taskPromptTokens: Object.fromEntries(
      Object.entries(AI_TASKS).map(([name, task]) => [name, count(task.system)]),
    ),
  }),
);
for (const example of cases) {
  let messages = buildConversation(example.message, example.history);
  const maxOutputTokens = chatOutputBudget(example.message);
  const metrics = {
    id: example.id,
    systemTokens: count(messages[0]!.content),
    historyTokens: messages.slice(1, -1).reduce((n, m) => n + count(m.content), 0),
    userTokens: count(messages.at(-1)!.content),
    messages: messages.length,
    serializedMessageChars: JSON.stringify(messages).length,
    completionCeiling: completionBudget({ action: 'chat', maxOutputTokens }),
  };
  if (!live) {
    console.info(JSON.stringify(metrics));
    continue;
  }
  // For a real same-chat follow-up, first obtain the preceding model response.
  if (example.id === 'follow-up') {
    const previous = await requestChat({
      action: 'chat',
      messages: buildConversation(history[0]!.content, []),
      maxOutputTokens: 800,
    });
    messages = buildConversation(example.message, [
      history[0]!,
      { role: 'assistant', content: cleanAiText(guardReply(previous.text)) },
    ]);
    metrics.historyTokens = messages.slice(1, -1).reduce((n, m) => n + count(m.content), 0);
    metrics.serializedMessageChars = JSON.stringify(messages).length;
  }
  const result = await requestChat({ action: 'chat', messages, maxOutputTokens });
  const text = cleanAiText(guardReply(result.text));
  // Coarse smoke checks, not a substitute for curriculum/content review.
  const checks = {
    nonempty: text.length > 0,
    noLeak: guardReply(result.text) === result.text,
    arithmetic: !['arithmetic', 'independent'].includes(example.id) || /\b36\b/.test(text),
    noAdvancedGravity:
      !['moon', 'hard-mavo', 'long-chat'].includes(example.id) ||
      !/GM|universitair|differentiaal/i.test(text),
    conciseGreeting: example.id !== 'greeting' || text.split(/\s+/).length <= 30,
  };
  console.info(
    JSON.stringify({
      ...metrics,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      answerWords: text.split(/\s+/).length,
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
