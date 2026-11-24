import { describe, expect, it } from 'vitest';
import { compactarComentarios, digestoDeRegistro, evitado, resumirUso, usoDeLinea, type RegistroUso } from '../src/index.js';

describe('digesto de un registro de Actions', () => {
  const ruido = Array.from({ length: 400 }, (_, i) => `2026-11-23T10:00:${String(i % 60).padStart(2, '0')}.123Z [INFO] Downloading org/lib-${i}.jar`).join('\n');
  const fallo = [
    '2026-11-23T10:05:00.000Z [ERROR] Tests run: 12, Failures: 1, Errors: 0, Skipped: 0',
    '2026-11-23T10:05:00.100Z [ERROR] AplicarBaremoBFAServiceTest.rechazaSinClave:41 expected: <true> but was: <false>',
    '2026-11-23T10:05:01.000Z ##[error]Process completed with exit code 1.',
  ].join('\n');

  it('se queda con el fallo y descarta las descargas', () => {
    const d = digestoDeRegistro(`${ruido}\n${fallo}`);
    expect(d).toContain('Tests run: 12, Failures: 1');
    expect(d).toContain('rechazaSinClave:41');
    expect(d).not.toContain('lib-200.jar');
    expect(d).not.toMatch(/2026-11-23T/);
  });

  it('pesa una fracción del registro original', () => {
    const e = evitado('registro-ci', `${ruido}\n${fallo}`, digestoDeRegistro(`${ruido}\n${fallo}`));
    expect(e.despues).toBeLessThan(e.antes * 0.1);
  });

  it('sin errores reconocibles devuelve el final del registro', () => {
    expect(digestoDeRegistro('uno\ndos\ntres')).toBe('uno\ndos\ntres');
  });
});

describe('comentarios de revisión compactos', () => {
  it('indica dónde, quién y qué piden, y no repite', () => {
    const t = compactarComentarios([
      { autor: 'over2099', archivo: 'backend/A.java', linea: 40, texto: 'Falta   validar\nel rango.' },
      { autor: 'over2099', archivo: 'backend/A.java', linea: 40, texto: 'Falta validar el rango.' },
      { autor: 'kisnner26', texto: 'Parte el PR en dos.' },
    ]);
    expect(t.split('\n')).toEqual(['- backend/A.java:40 (over2099): Falta validar el rango.', '- general (kisnner26): Parte el PR en dos.']);
  });

  it('corta los comentarios largos', () => {
    expect(compactarComentarios([{ autor: 'a', texto: 'x'.repeat(2000) }], 100).length).toBeLessThan(130);
  });
});

describe('medición de uso', () => {
  it('lee el uso real que informa Claude Code al terminar', () => {
    const linea = JSON.stringify({ type: 'result', result: 'ok', total_cost_usd: 0.021, usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 8000, cache_creation_input_tokens: 500 } });
    expect(usoDeLinea('claude', linea)).toEqual({ entrada: 1200, salida: 300, cacheLeida: 8000, cacheCreada: 500, costoUsd: 0.021 });
  });

  it('lee el uso de Codex y no inventa si no viene', () => {
    expect(usoDeLinea('codex', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 900, cached_input_tokens: 400, output_tokens: 80 } }))).toEqual({ entrada: 900, salida: 80, cacheLeida: 400, cacheCreada: 0 });
    expect(usoDeLinea('claude', JSON.stringify({ type: 'assistant' }))).toBeUndefined();
    expect(usoDeLinea('claude', 'no es json')).toBeUndefined();
  });

  it('suma lo gastado y lo evitado por técnica, sin contar aumentos', () => {
    const regs: RegistroUso[] = [
      { fecha: 'x', paso: 'arreglar-ci', ref: '#5', modelo: 'sonnet', ms: 10, uso: { entrada: 1000, salida: 200, cacheLeida: 0, cacheCreada: 0, costoUsd: 0.01 }, evitados: [{ tecnica: 'registro-ci', antes: 9000, despues: 600 }, { tecnica: 'extracto', antes: 100, despues: 200 }] },
      { fecha: 'x', paso: 'recordar', ref: '#5', modelo: '-', ms: 1, local: true, evitados: [{ tecnica: 'paso-local', antes: 700, despues: 0 }] },
    ];
    const r = resumirUso(regs);
    expect(r.pasos).toBe(2);
    expect(r.locales).toBe(1);
    expect(r.tokensEvitados).toBe(9100);
    expect(r.porTecnica[0]).toEqual({ tecnica: 'registro-ci', tokens: 8400, veces: 1 });
    expect(r.porTecnica.find((x) => x.tecnica === 'extracto')).toBeUndefined();
    expect(r.tokensSinHilo).toBe(1000 + 9100);
    expect(r.ahorro).toBeCloseTo(9100 / 10100, 5);
    expect(r.costoUsd).toBeCloseTo(0.01, 5);
  });

  it('sin registros no divide entre cero', () => {
    expect(resumirUso([]).ahorro).toBe(0);
  });
});
