import { describe, expect, it } from 'vitest';
import { argumentosWhisper, elegirIdioma, escribirWav, leerIdioma, limpiarTranscripcion, volumen, PROMPT_TECNICO } from '../src/index.js';

describe('dictado con Whisper', () => {
  it('lee el idioma que detectó Whisper', () => {
    expect(leerIdioma('whisper_full_with_state: auto-detected language: es (p = 0.986123)')).toEqual({ codigo: 'es', p: 0.986123 });
    expect(leerIdioma('nada')).toBeUndefined();
  });

  it('solo acepta español e inglés y cae en español si detecta otro idioma', () => {
    expect(elegirIdioma({ codigo: 'en', p: 0.9 })).toBe('en');
    expect(elegirIdioma({ codigo: 'ms', p: 0.8 })).toBe('es');
    expect(elegirIdioma({ codigo: 'pt', p: 0.6 })).toBe('es');
    expect(elegirIdioma(undefined)).toBe('es');
  });

  it('arma los argumentos: idioma, sin marcas de tiempo y vocabulario del trabajo', () => {
    const a = argumentosWhisper({ modelo: 'm.bin', archivo: 'a.wav', idioma: 'auto' });
    expect(a).toEqual(expect.arrayContaining(['-m', 'm.bin', '-f', 'a.wav', '-l', 'auto', '-nt', '-np']));
    expect(a[a.indexOf('--prompt') + 1]).toBe(PROMPT_TECNICO);
    expect(a).not.toContain('-bs');
    expect(argumentosWhisper({ modelo: 'm', archivo: 'a', idioma: 'es', rapido: true })).toEqual(expect.arrayContaining(['-bs', '1', '-bo', '1']));
  });

  it('limpia lo que Whisper inventa en los silencios', () => {
    expect(limpiarTranscripcion(' [BLANK_AUDIO]\n')).toBe('');
    expect(limpiarTranscripcion('(música)')).toBe('');
    expect(limpiarTranscripcion('♪ ♪')).toBe('');
    expect(limpiarTranscripcion('Subtítulos realizados por la comunidad de Amara.org')).toBe('');
    expect(limpiarTranscripcion('Thanks for watching!')).toBe('');
    expect(limpiarTranscripcion('  ¿Qué tarea\n tengo   hoy? ')).toBe('¿Qué tarea tengo hoy?');
    expect(limpiarTranscripcion('Revisa el pull request [BLANK_AUDIO] ahora')).toBe('Revisa el pull request ahora');
  });

  it('escribe un WAV válido de 16 kHz y 16 bits', () => {
    const w = escribirWav(new Int16Array([0, 1000, -1000, 32767]));
    expect(w.subarray(0, 4).toString()).toBe('RIFF');
    expect(w.subarray(8, 12).toString()).toBe('WAVE');
    expect(w.readUInt32LE(24)).toBe(16000);
    expect(w.readUInt16LE(34)).toBe(16);
    expect(w.readUInt32LE(40)).toBe(8);
    expect(w.length).toBe(44 + 8);
  });

  it('mide el volumen para no mandar silencio', () => {
    expect(volumen(new Int16Array(100))).toBe(0);
    expect(volumen(new Int16Array(100).fill(16384))).toBeCloseTo(0.5, 3);
    expect(volumen(new Int16Array(0))).toBe(0);
  });
});
