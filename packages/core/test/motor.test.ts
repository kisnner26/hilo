import { describe, expect, it } from 'vitest';
import { elegirModeloOllama, elegirMotor, explicarRazonApple, generarOllama, recortarParaLocal, sondearOllama } from '../src/index.js';

const e = (id: string, disponible: boolean) => ({ id, disponible }) as { id: 'claude'; disponible: boolean };

describe('elegir motor', () => {
  it('prefiere un agente de suscripción, luego lo que corre en el equipo, y al final las reglas', () => {
    expect(elegirMotor([e('claude', true), e('apple', true), e('ollama', true)])).toBe('claude');
    expect(elegirMotor([e('claude', false), e('codex', true), e('apple', true)])).toBe('codex');
    expect(elegirMotor([e('claude', false), e('codex', false), e('apple', true), e('ollama', true)])).toBe('apple');
    expect(elegirMotor([e('apple', false), e('ollama', true)])).toBe('ollama');
    expect(elegirMotor([e('claude', false), e('apple', false), e('ollama', false)])).toBe('reglas');
    expect(elegirMotor([])).toBe('reglas');
  });
  it('respeta lo que eligió la persona solo si está disponible', () => {
    const todos = [e('claude', true), e('apple', true)];
    expect(elegirMotor(todos, 'apple')).toBe('apple');
    expect(elegirMotor(todos, 'reglas')).toBe('reglas');
    expect(elegirMotor([e('claude', true), e('apple', false)], 'apple')).toBe('claude');
  });
});

describe('modelos locales', () => {
  it('recorta conservando el principio y el final', () => {
    const largo = `INICIO${'x'.repeat(5000)}FINAL`;
    const r = recortarParaLocal(largo, 300);
    expect(r.length).toBeLessThan(1500);
    expect(r.startsWith('INICIO')).toBe(true);
    expect(r.endsWith('FINAL')).toBe(true);
    expect(recortarParaLocal('corto', 300)).toBe('corto');
  });
  it('explica por qué Apple Intelligence no está', () => {
    expect(explicarRazonApple('deviceNotEligible')).toContain('no es compatible');
    expect(explicarRazonApple('appleIntelligenceNotEnabled')).toContain('apagado');
    expect(explicarRazonApple('modelNotReady')).toContain('descargando');
  });
  it('elige un modelo de Ollama útil y pequeño, nunca uno de imágenes ni de incrustaciones', () => {
    const m = (nombre: string, gb: number) => ({ nombre, bytes: gb * 1e9 });
    expect(elegirModeloOllama([m('nomic-embed-text', 0.3), m('llava:7b', 4)])).toBeUndefined();
    expect(elegirModeloOllama([m('llama3.2:3b', 2), m('qwen2.5:7b', 4.7), m('llama3.1:70b', 40)])).toBe('qwen2.5:7b');
    expect(elegirModeloOllama([m('llama3.1:70b', 40), m('desconocido:3b', 2)])).toBe('desconocido:3b');
    expect(elegirModeloOllama([m('llama3.2:3b', 2), m('qwen2.5:7b', 4.7)], 'llama3.2:3b')).toBe('llama3.2:3b');
  });
  it('detecta si Ollama está encendido y qué modelos tiene', async () => {
    const vivo = async () => ({ ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen2.5:3b', size: 2e9 }] }) });
    expect(await sondearOllama(vivo)).toEqual({ activo: true, modelos: [{ nombre: 'qwen2.5:3b', bytes: 2e9 }] });
    const muerto = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await sondearOllama(muerto)).toEqual({ activo: false, modelos: [] });
  });
  it('lee la respuesta de Ollama a medida que llega', async () => {
    const trozos = ['{"message":{"content":"Hola"}}\n{"message":{"content":", mu', 'ndo"}}\n{"done":true}\n'];
    const cuerpo = new ReadableStream<Uint8Array>({
      start(c) {
        for (const t of trozos) c.enqueue(new TextEncoder().encode(t));
        c.close();
      },
    });
    const vistos: string[] = [];
    const t = await generarOllama({ prompt: 'hola', alTexto: (d) => vistos.push(d) }, 'qwen2.5:3b', async () => ({ ok: true, status: 200, body: cuerpo, json: async () => ({}) }));
    expect(t).toBe('Hola, mundo');
    expect(vistos).toEqual(['Hola', ', mundo']);
  });
  it('explica el fallo si Ollama no responde bien', async () => {
    await expect(generarOllama({ prompt: 'x' }, 'm', async () => ({ ok: false, status: 404, body: null, json: async () => ({}) }))).rejects.toThrow('Ollama respondió 404');
  });
});
