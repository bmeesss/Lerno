import { describe, expect, it } from 'vitest';
import {
  detectMaterialConcepts,
  hasUsableMaterial,
  materialCharacterCount,
  materialFingerprint,
  materialWordCount,
  sanitizeMaterialText,
  MAX_MATERIAL_CHARS,
} from './material-analysis.js';

const NOTES = [
  'Fotosynthese is het proces waarbij planten lichtenergie omzetten in glucose.',
  'Chlorofyl is de groene stof in bladgroenkorrels die licht opneemt.',
  'Mitose is de deling van de celkern waarbij twee identieke cellen ontstaan.',
].join('\n');

describe('material analysis: sanitizing', () => {
  it('removes control characters and collapses whitespace', () => {
    const messy = 'Titel\u0000\r\n\r\n\r\n  Fotosynthese\tis   het\u0007proces  ';
    expect(sanitizeMaterialText(messy)).toBe('Titel\n\nFotosynthese is het proces');
  });

  it('bounds stored material to the source limit', () => {
    const sanitized = sanitizeMaterialText('a'.repeat(MAX_MATERIAL_CHARS + 5_000));
    expect(sanitized.length).toBe(MAX_MATERIAL_CHARS);
  });

  it('counts words and readable characters, not raw length', () => {
    expect(materialWordCount('Een twee   drie\nvier')).toBe(4);
    expect(materialCharacterCount(' Een twee ')).toBe(7);
    expect(materialWordCount('— – !')).toBe(0);
  });

  it('refuses material that is too short to study', () => {
    expect(hasUsableMaterial('te kort')).toBe(false);
    expect(hasUsableMaterial(NOTES)).toBe(true);
  });
});

describe('material analysis: fingerprints', () => {
  it('matches the same material regardless of case and whitespace', () => {
    const a = materialFingerprint('Fotosynthese is het proces.');
    const b = materialFingerprint('  fotosynthese   is\n\nhet proces.  ');
    expect(a).toBe(b);
  });

  it('separates different material', () => {
    expect(materialFingerprint(NOTES)).not.toBe(materialFingerprint(`${NOTES} Extra zin.`));
  });
});

describe('material analysis: concept candidates', () => {
  it('finds defined terms with the sentence they came from', () => {
    const concepts = detectMaterialConcepts(NOTES);
    const names = concepts.map((concept) => concept.name);
    expect(names).toContain('Fotosynthese');
    expect(names).toContain('Chlorofyl');
    const photosynthesis = concepts.find((concept) => concept.name === 'Fotosynthese')!;
    // The explanation is the original sentence, never a generated definition.
    expect(photosynthesis.explanation).toContain('lichtenergie');
  });

  it('reads term lists as concepts', () => {
    const concepts = detectMaterialConcepts(
      [
        'Mitose: deling van de celkern waarbij twee identieke cellen ontstaan.',
        'Osmose: verplaatsing van water door een halfdoorlatende membraan.',
        'Diffusie: beweging van deeltjes van veel naar weinig concentratie.',
      ].join('\n'),
    );
    expect(concepts.map((concept) => concept.name)).toEqual(
      expect.arrayContaining(['Mitose', 'Osmose', 'Diffusie']),
    );
  });

  it('falls back to terms that repeat when there are no definitions', () => {
    const concepts = detectMaterialConcepts(
      [
        'De Eerste Wet van Newton beschrijft rust en beweging.',
        'Met de Eerste Wet van Newton verklaar je waarom een puck doorschiet.',
        'Ook de Eerste Wet van Newton komt terug in het examen.',
      ].join(' '),
    );
    expect(concepts.map((concept) => concept.name.toLowerCase())).toContain(
      'eerste wet van newton',
    );
  });

  it('never invents concepts for unrelated prose', () => {
    const concepts = detectMaterialConcepts('vandaag was het mooi weer en we gingen naar buiten.');
    expect(concepts).toEqual([]);
  });

  it('is deterministic and bounded', () => {
    const first = detectMaterialConcepts(NOTES, 2);
    const second = detectMaterialConcepts(NOTES, 2);
    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(2);
  });
});
