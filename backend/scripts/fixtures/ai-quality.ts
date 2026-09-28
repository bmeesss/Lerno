/** Development-only curriculum probes. Regex signals are NOT factual verification.
 * Each probe includes a reviewed acceptable answer and a known failure to test
 * the detector itself. Never import this fixture into the production pipeline.
 */
export interface QualityCase {
  id: string;
  subject: string;
  prompt: string;
  good: string;
  bad: string;
  required: RegExp[];
  forbidden?: RegExp[];
  oneQuestion?: boolean;
  maxWords?: number;
}

export const QUALITY_CASES: QualityCase[] = [
  {
    id: 'percent',
    subject: 'wiskunde',
    prompt: 'Wat is 15% van 240?',
    good: '0,15 × 240 = 36.',
    bad: 'Het antwoord is 15.',
    required: [/\b36\b/],
    maxWords: 60,
  },
  {
    id: 'equation',
    subject: 'wiskunde',
    prompt: 'Los 3x + 7 = 22 stap voor stap op.',
    good: 'Trek 7 af: 3x = 15. Deel door 3: x = 5.',
    bad: 'x = 15.',
    required: [/x\s*=\s*5\b/, /15/],
  },
  {
    id: 'pythagoras',
    subject: 'wiskunde',
    prompt:
      'Een rechthoekige driehoek heeft rechthoekszijden a = 3 cm en b = 4 cm. Bereken schuine zijde c.',
    good: 'c is de schuine zijde. c² = a² + b² = 9 + 16 = 25, dus c = 5 cm.',
    bad: 'c is een rechthoekszijde. c = 7 cm.',
    required: [/c\s*=\s*5\s*(?:\\text\{)?cm/, /schuine|hypotenus/],
    forbidden: [/c is (?:een |de )?rechthoekszijde/],
  },
  {
    id: 'discount',
    subject: 'wiskunde',
    prompt: 'Een jas kost 80 euro. Je krijgt 25% korting. Wat betaal je?',
    good: 'Korting: 0,25 × 80 = 20 euro. Je betaalt 80 − 20 = 60 euro.',
    bad: 'Je betaalt 20 euro.',
    required: [/\b60\b/, /euro|€/],
    maxWords: 90,
  },
  {
    id: 'mass-weight',
    subject: 'natuurkunde',
    prompt: 'Leg het verschil tussen massa en gewicht uit op mavo 3-niveau.',
    good: 'Massa is de hoeveelheid materie in kilogram (kg). Gewicht is een kracht, gemeten in newton (N).',
    bad: 'Massa meet je in newton en gewicht in kilogram.',
    required: [/massa[^.!\n]*(?:kilogram|kg)/i, /gewicht[^.!\n]*kracht/i, /newton/i],
    maxWords: 160,
  },
  {
    id: 'moon',
    subject: 'natuurkunde',
    prompt:
      'Waarom is het gewicht op de maan ongeveer 1/6 van dat op aarde? Leg uit op mavo 3-niveau.',
    good: 'Je massa blijft gelijk. De zwaartekracht op de maan is ongeveer zes keer zo klein; je gewicht dus ook. De maan heeft veel minder massa dan de aarde.',
    bad: 'Je massa wordt zes keer kleiner. g = GM/R².',
    required: [
      /massa[^.!\n]*(?:gelijk|zelfde|verandert niet)/i,
      /zwaartekracht/i,
      /zes|1\s*\/\s*6/,
    ],
    forbidden: [/G\s*\*?\s*M\s*\/\s*R/i, /kleinere maan heeft minder massa/i],
    maxWords: 150,
  },
  {
    id: 'force',
    subject: 'natuurkunde',
    prompt: 'Bereken het gewicht van 5 kg met g = 10 N/kg. Gebruik F = m × g.',
    good: 'F = m × g = 5 × 10 = 50 N.',
    bad: 'F = 5 / 10 = 0,5 kg.',
    required: [/F\s*=\s*m\s*[×*·]\s*g/i, /50\s*(?:N\b|newton)/i],
  },
  {
    id: 'work',
    subject: 'natuurkunde',
    prompt: 'Je tilt met 20 N een tas 2 m omhoog. Bereken arbeid W = F × h.',
    good: 'W = F × h = 20 × 2 = 40 J.',
    bad: 'W = 20 / 2 = 10 N.',
    required: [/W\s*=\s*F\s*[×*·]\s*h/i, /40\s*(?:J\b|joule)/i],
  },
  {
    id: 'photosynthesis',
    subject: 'biologie',
    prompt: 'Leg fotosynthese kort uit op mavo 3-niveau, ook wat glucose is.',
    good: 'Met licht maakt de plant uit water en koolstofdioxide glucose en zuurstof. Glucose is een suiker, bruikbaar als energiebron of bouwstof voor andere stoffen.',
    bad: 'Planten maken zuurstof; daardoor ruik je frisse lucht. Glucose is alleen brandstof.',
    required: [
      /licht/i,
      /water/i,
      /koolstofdioxide|CO_?2|CO₂/i,
      /glucose/i,
      /zuurstof/i,
      /bouwstof/i,
    ],
    forbidden: [
      /frisse lucht[^.!\n]*ruik|ruik[^.!\n]*frisse lucht/i,
      /glucose[^.!\n]*alleen[^.!\n]*brandstof/i,
    ],
    maxWords: 160,
  },
  {
    id: 'chlorophyll',
    subject: 'biologie',
    prompt: 'Wat doet chlorofyl bij fotosynthese?',
    good: 'Chlorofyl (bladgroen) absorbeert licht voor fotosynthese.',
    bad: 'Chlorofyl neemt zuurstof op als voedsel.',
    required: [/licht/i, /absorbeert|vangt|neemt.*op/i],
  },
  {
    id: 'nucleus',
    subject: 'biologie',
    prompt: 'Wat is het verschil tussen een cel en een celkern?',
    good: 'Een cel is een levende bouwsteen. De celkern is een onderdeel van veel cellen en bevat DNA.',
    bad: 'Een cel is hetzelfde als een celkern.',
    required: [/onderdeel/i, /DNA|erfelijk/i],
    forbidden: [/cel is hetzelfde als een celkern/i],
  },
  {
    id: 'circulation',
    subject: 'biologie',
    prompt: 'Beschrijf de kleine bloedsomloop op mavo 3-niveau.',
    good: 'Het bloed stroomt vanuit het hart naar de longen en terug naar het hart. In de longen neemt het zuurstof op.',
    bad: 'De kleine bloedsomloop loopt van het hart naar de benen.',
    required: [/hart[\s\S]*long[\s\S]*hart/i, /zuurstof/i],
  },
  {
    id: 'revolution',
    subject: 'geschiedenis',
    prompt: 'Leg de Franse Revolutie kort uit op mavo 3-niveau. Noem de koning bij het uitbreken.',
    good: 'In 1789 begon de Franse Revolutie. Mensen kwamen in opstand tegen ongelijkheid en de macht van koning Lodewijk XVI.',
    bad: 'In 1789 regeerde Lodewijk XIV tijdens de Franse Revolutie.',
    required: [/1789/, /Lodewijk\s+XVI\b|Louis\s+XVI\b/i],
    forbidden: [/\b(?:Lodewijk|Louis)\s+XIV\b/i],
    maxWords: 180,
  },
  {
    id: 'king',
    subject: 'geschiedenis',
    prompt: 'Welke Franse koning werd in 1793 tijdens de Franse Revolutie terechtgesteld?',
    good: 'Lodewijk XVI werd in 1793 terechtgesteld.',
    bad: 'Lodewijk XIV werd in 1793 terechtgesteld.',
    required: [/Lodewijk\s+XVI\b|Louis\s+XVI\b/i],
    maxWords: 60,
  },
  {
    id: 'causes',
    subject: 'geschiedenis',
    prompt: 'Noem twee oorzaken van de Franse Revolutie.',
    good: '- Ongelijkheid tussen de standen.\n- De financiële crisis van de staat.',
    bad: 'Alleen het slechte weer was de oorzaak.',
    required: [/ongelijk|privilege/i, /financi|schuld|belasting/i],
  },
  {
    id: 'estates',
    subject: 'geschiedenis',
    prompt: 'Welke drie standen waren er vóór de Franse Revolutie?',
    good: 'Geestelijkheid, adel en de derde stand: de overige bevolking.',
    bad: 'Koning, soldaten en buitenlanders.',
    required: [/geestelijk/i, /adel/i, /derde stand|burgers.*boeren/i],
  },
  {
    id: 'verb',
    subject: 'Nederlands',
    prompt: 'Wat is de persoonsvorm in: De kinderen spelen buiten? Leg kort uit.',
    good: 'Spelen is de persoonsvorm: in de verleden tijd wordt het speelden.',
    bad: 'Kinderen is de persoonsvorm.',
    required: [/spelen/i, /speelden|tijd|enkelvoud/i],
    maxWords: 80,
  },
  {
    id: 'subject',
    subject: 'Nederlands',
    prompt: 'Wat is het onderwerp in: De kinderen spelen buiten?',
    good: 'De kinderen. Wie spelen buiten? De kinderen.',
    bad: 'Buiten is het onderwerp.',
    required: [/de kinderen/i],
    maxWords: 60,
  },
  {
    id: 'spelling',
    subject: 'Nederlands',
    prompt: 'Vul in: Hij ... morgen achttien. Kies word of wordt en leg kort uit.',
    good: 'Hij wordt morgen achttien. Bij hij gebruik je de stam plus t.',
    bad: 'Hij word morgen achttien, zonder t.',
    required: [/\bwordt\b/, /stam|\+\s*t|plus t/i],
  },
  {
    id: 'clause',
    subject: 'Nederlands',
    prompt: 'Leg hoofdzin en bijzin uit met: Ik blijf thuis omdat ik ziek ben.',
    good: 'Ik blijf thuis is de hoofdzin. Omdat ik ziek ben is de bijzin; de persoonsvorm ben staat daar achteraan.',
    bad: 'Omdat ik ziek ben is de hoofdzin.',
    required: [/ik blijf thuis[^.!]*hoofdzin/i, /omdat ik ziek ben[^.!]*bijzin/i],
  },
  {
    id: 'english-translation',
    subject: 'Engels',
    prompt: 'Translate into English: Ik ga elke dag naar school. Give only the translation.',
    good: 'I go to school every day.',
    bad: 'Ik ga naar school.',
    required: [/I go to school every day/i],
    maxWords: 15,
  },
  {
    id: 'english-grammar',
    subject: 'Engels',
    prompt: 'Answer in English: why is it she plays, not she play?',
    good: 'In the present simple, add s for he, she and it: she plays.',
    bad: 'Je voegt een s toe.',
    required: [/present simple/i, /\bs\b/i, /she plays/i],
  },
  {
    id: 'german-translation',
    subject: 'Duits',
    prompt: 'Vertaal naar Duits, alleen de vertaling: Ik heb een boek.',
    good: 'Ich habe ein Buch.',
    bad: 'I have a book.',
    required: [/Ich habe ein Buch/i],
    maxWords: 15,
  },
  {
    id: 'german-grammar',
    subject: 'Duits',
    prompt: 'Antworte auf Deutsch: Ergänze du ... (sein) und erkläre kurz.',
    good: 'Du bist. Bist ist die Form von sein für du.',
    bad: 'Du ist. Dat is de juiste vorm.',
    required: [/du bist/i, /Form|zweite Person/i],
  },
  {
    id: 'hard-mavo',
    subject: 'natuurkunde',
    prompt:
      'Overhoor mij: geef één moeilijke vraag over massa en gewicht op mavo 3. Geef geen antwoord.',
    good: 'Een voorwerp heeft een massa van 6 kg; g = 10 N/kg. Wat is het gewicht?',
    bad: 'Wat is het gewicht? Wat is de massa? Antwoord: 60 N.',
    required: [/\?/],
    forbidden: [/antwoord\s*:|oplossing\s*:|\b60\s*N\b|G\s*M\s*\/\s*R/i],
    oneQuestion: true,
    maxWords: 100,
  },
  {
    id: 'hint',
    subject: 'wiskunde',
    prompt: 'Geef alleen een kleine hint voor 3x + 7 = 22, niet het antwoord.',
    good: 'Welke bewerking maakt de + 7 ongedaan?',
    bad: 'Trek 7 af en deel door 3: x = 5.',
    required: [/7/],
    forbidden: [/x\s*=\s*5|\b(?:antwoord|oplossing)\s*(?:is|:)\s*5/i],
    maxWords: 45,
  },
];

export function qualitySignals(example: QualityCase, text: string): Record<string, boolean> {
  return {
    nonempty: text.trim().length > 0,
    expectedConcepts: example.required.every((pattern) => pattern.test(text)),
    noKnownError: !(example.forbidden ?? []).some((pattern) => pattern.test(text)),
    requestedQuestionCount: !example.oneQuestion || (text.match(/\?/g) ?? []).length === 1,
    length: text.trim().split(/\s+/).length <= (example.maxWords ?? 250),
    noBoilerplate: !/^(?:Natuurlijk!|Sure!|Hieronder leg ik)|Laat het me weten|Let me know/i.test(
      text.trim(),
    ),
    noRawHtml: !/<\/?[a-z][^>]*>/i.test(text),
    schoolLevel:
      example.subject !== 'natuurkunde' || !/G\s*[*·]?\s*M\s*\/\s*R|\\frac\s*\{GM\}/i.test(text),
  };
}

export interface CurriculumQualityCase {
  id: string;
  prompt: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  contextSource: 'chat' | 'none';
  mode: 'request-material' | 'answer';
  communicateUncertainty?: boolean;
  good: string;
  bad: string;
  required: RegExp[];
  forbidden?: RegExp[];
}

/** Focused context-quality probes; fixed examples, never used in production. */
export const CURRICULUM_QUALITY_CASES: CurriculumQualityCase[] = [
  {
    id: 'unknown-chapter',
    prompt: 'Ik heb morgen een toets biologie over hoofdstuk 1. Wat moet ik leren?',
    contextSource: 'none',
    mode: 'request-material',
    communicateUncertainty: true,
    good: 'Dat verschilt per boek en methode. Stuur een foto of de onderwerpen; dan kan ik uitleg geven, je overhoren of oefenvragen maken.',
    bad: 'Hoofdstuk 1 gaat over cellen, weefsels en organen. Leer die begrippen goed.',
    required: [
      /verschilt|hangt af/i,
      /stuur|deel|upload/i,
      /foto|onderwerpen|inhoudsopgave|begrippen/i,
    ],
    forbidden: [/hoofdstuk\s+1\s+(?:gaat over|behandelt|bestaat uit)/i],
  },
  {
    id: 'general-photosynthesis',
    prompt: 'Wat is fotosynthese?',
    contextSource: 'none',
    mode: 'answer',
    good: 'Bij fotosynthese gebruikt een plant licht om water en koolstofdioxide om te zetten in glucose en zuurstof.',
    bad: 'Stuur eerst je boek of methode, anders kan ik niet antwoorden.',
    required: [/fotosynthese/i, /licht/i, /glucose|koolstofdioxide/i],
    forbidden: [/stuur eerst|welk boek|welke methode/i],
  },
  {
    id: 'provided-chapter-topics',
    prompt: 'Hoofdstuk 1 gaat over fotosynthese, ademhaling en bloedsomloop. Wat moet ik kennen?',
    contextSource: 'chat',
    mode: 'answer',
    good: 'Leer de kern van fotosynthese, ademhaling en bloedsomloop; ik kan je daarover overhoren.',
    bad: 'Stuur eerst de onderwerpen van hoofdstuk 1.',
    required: [/fotosynthese/i, /ademhaling/i, /bloedsomloop/i],
    forbidden: [/stuur eerst|wat zijn de onderwerpen/i],
  },
  {
    id: 'chat-flashcards',
    prompt:
      'Hier zijn mijn flashcards. Overhoor mij: Vraag: Wat is osmose? Antwoord: Verplaatsing van water door een membraan.',
    contextSource: 'chat',
    mode: 'answer',
    good: 'Wat verplaatst zich bij osmose door een membraan?',
    bad: 'Stuur eerst je flashcards, dan kan ik je overhoren.',
    required: [/osmose/i, /membraan/i],
    forbidden: [/stuur eerst|deel eerst/i],
  },
  {
    id: 'unknown-book-chapter',
    prompt: 'Wat staat er in hoofdstuk 4 van mijn boek?',
    contextSource: 'none',
    mode: 'request-material',
    communicateUncertainty: true,
    good: 'Dat hangt af van je boek. Stuur een foto van de inhoudsopgave of deel de hoofdstuktitel, dan help ik je.',
    bad: 'Hoofdstuk 4 behandelt meestal erfelijkheid en DNA.',
    required: [/hangt af|verschilt/i, /stuur|deel/i, /foto|inhoudsopgave|hoofdstuktitel/i],
    forbidden: [/hoofdstuk\s+4\s+(?:behandelt|gaat over|is over)/i],
  },
  {
    id: 'unknown-method',
    prompt: 'Wat moet ik kennen voor BioKompas hoofdstuk 5?',
    contextSource: 'none',
    mode: 'request-material',
    communicateUncertainty: true,
    good: 'Dat verschilt per methode. Stuur de onderwerpen of een foto van de inhoudsopgave van BioKompas hoofdstuk 5.',
    bad: 'BioKompas hoofdstuk 5 gaat over voortplanting en genetica.',
    required: [/verschilt|hangt af/i, /stuur|deel/i, /onderwerpen|foto|inhoudsopgave/i],
    forbidden: [/BioKompas\s+hoofdstuk\s+5\s+(?:gaat over|behandelt)/i],
  },
  {
    id: 'tomorrow-no-syllabus',
    prompt: 'Help mij leren voor morgen.',
    contextSource: 'none',
    mode: 'request-material',
    good: 'Natuurlijk. Welke stof moet je kennen? Stuur je onderwerpen of een foto; dan maak ik er een planning of oefenvragen van.',
    bad: 'Begin met cellen, leer daarna fotosynthese en sluit af met een quiz over erfelijkheid.',
    required: [/welke stof|onderwerpen/i, /stuur|foto|deel/i],
    forbidden: [/begin met|leer daarna/i],
  },
  {
    id: 'follow-up-after-material',
    prompt: 'Help mij leren voor morgen.',
    history: [
      { role: 'user', content: 'Mijn toetsstof is fotosynthese, ademhaling en bloedsomloop.' },
    ],
    contextSource: 'chat',
    mode: 'answer',
    good: 'We oefenen fotosynthese, ademhaling en bloedsomloop. Wat is de functie van glucose bij fotosynthese?',
    bad: 'Stuur eerst de onderwerpen die je moet leren.',
    required: [/fotosynthese/i, /ademhaling/i, /bloedsomloop/i],
    forbidden: [/stuur eerst|welke onderwerpen/i],
  },
  {
    id: 'material-provided-after-request',
    prompt: 'De onderwerpen zijn fotosynthese, ademhaling en bloedsomloop.',
    history: [
      { role: 'user', content: 'Help mij leren voor morgen.' },
      { role: 'assistant', content: 'Welke stof moet je kennen?' },
    ],
    contextSource: 'chat',
    mode: 'answer',
    good: 'We kunnen oefenen met fotosynthese, ademhaling en bloedsomloop. Wat is fotosynthese?',
    bad: 'Stuur eerst de onderwerpen die je moet leren.',
    required: [/fotosynthese/i, /ademhaling/i, /bloedsomloop/i],
    forbidden: [/stuur eerst|welke onderwerpen/i],
  },
];

export function curriculumQualitySignals(
  example: CurriculumQualityCase,
  text: string,
): Record<string, boolean> {
  const asksForMaterial = /stuur|deel|upload|foto|inhoudsopgave|onderwerpen|methode|stof/i.test(
    text,
  );
  const communicatesUncertainty = /verschilt|hangt af|weet nog niet|afhankelijk/i.test(text);
  return {
    nonempty: text.trim().length > 0,
    requiredContext: example.required.every((pattern) => pattern.test(text)),
    noInventedCurriculum: !(example.forbidden ?? []).some((pattern) => pattern.test(text)),
    requestsSourceWhenMissing: example.mode !== 'request-material' || asksForMaterial,
    communicatesUncertaintyWhenMissing: !example.communicateUncertainty || communicatesUncertainty,
    doesNotBlockKnownContext:
      example.mode !== 'answer' || !/stuur eerst|welk boek|welke methode/i.test(text),
  };
}
