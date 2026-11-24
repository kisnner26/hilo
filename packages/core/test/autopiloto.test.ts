import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ahorroEfectivo, analizarBloqueos, cargarPerfil, claveDePaso, miDia, modeloDelPaso, ordenDeEjecucion, planAutopiloto, presetAhorro, promptDelPaso, topeDelPaso, type PrResumen, type TareaClickup } from '../src/index.js';

const perfil = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));
const ahora = new Date('2026-11-24T12:00:00Z');
const yo = { github: 'ana-dev', clickupId: 1, clickupUsuario: 'ANA' };
const tarea = (p: Partial<TareaClickup> & { codigo: string }): TareaClickup => ({ id: `id-${p.codigo}`, nombre: `${p.codigo} — x`, estado: 'in progress', lista: 'l', asignados: ['ANA'], asignadosIds: [1], dependeDe: [], ...p });
const pr = (p: Partial<PrResumen> & { numero: number }): PrResumen => ({ titulo: '[GEN-01-BE] x', autor: 'ana-dev', rama: 'feature/ana-GEN-01-BE', borrador: false, url: `https://github.com/o/r/pull/${p.numero}`, ci: 'ok', revision: 'requerida', estadoFusion: 'BLOCKED', pidenMiRevision: false, sha: 'abcdef123456', ...p });

function plan(tareas: TareaClickup[], prs: PrResumen[], opciones = {}) {
  const dia = miDia(tareas, prs, yo, perfil, ahora);
  return planAutopiloto(dia, analizarBloqueos(tareas, prs, yo, perfil, ahora), perfil, opciones);
}

describe('plan del autopiloto', () => {
  it('arregla el CI con un agente de escritura y publica solo con aprobación', () => {
    const p = plan([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 7, ci: 'fallo' })]);
    expect(p.find((x) => x.tipo === 'arreglar-ci')).toMatchObject({ ejecutor: 'agente', escritura: true, salida: 'push', peso: 'completo', tarea: 'GEN-01-BE' });
  });

  it('la rama atrasada de un PR propio la actualiza Hilo sin pedir nada', () => {
    const p = plan([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 7, atrasado: true })]);
    expect(p.find((x) => x.tipo === 'actualizar-rama')).toMatchObject({ ejecutor: 'hilo', salida: 'ninguna', prioridad: 1 });
  });

  it('el comentario de entrega sale redactado por Hilo con el SHA real', () => {
    const p = plan([tarea({ codigo: 'GEN-01-BE', estado: 'in progress' })], [pr({ numero: 7, revision: 'aprobado' })]);
    const e = p.find((x) => x.tipo === 'entregar');
    expect(e).toMatchObject({ ejecutor: 'hilo', salida: 'comentario-clickup', destino: 'id-GEN-01-BE' });
    expect(e!.texto).toContain('SHA probado: abcdef1');
    expect(e!.texto).not.toContain('SHA probado: FALTA');
  });

  it('avisa a quien te frena solo si lleva esperando y deja el texto listo', () => {
    const viejo = plan([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 7, actualizado: '2026-11-20T00:00:00Z', revisoresPedidos: ['over2099'] })]);
    const a = viejo.find((x) => x.tipo === 'avisar');
    expect(a).toMatchObject({ ejecutor: 'hilo', salida: 'comentario-github', destino: '7' });
    expect(a!.texto).toContain('@over2099');
    const reciente = plan([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 7, actualizado: '2026-11-24T10:00:00Z', revisoresPedidos: ['over2099'] })]);
    expect(reciente.find((x) => x.tipo === 'avisar')).toBeUndefined();
  });

  it('una dependencia abierta con la tarea bloqueada deja el comentario de bloqueo ya escrito', () => {
    const dep = tarea({ codigo: 'GEN-00-API', id: 'api', asignados: ['LUIS'], asignadosIds: [2] });
    const p = plan([tarea({ codigo: 'BFA-FE-01', estado: 'blocked', dependeDe: ['api'] }), dep], []);
    const b = p.find((x) => x.tipo === 'explicar-bloqueo');
    expect(b).toMatchObject({ ejecutor: 'hilo', salida: 'comentario-clickup' });
    expect(b!.texto).toContain('Depende de: LUIS');
  });

  it('arranca una sola tarea nueva por corrida', () => {
    const p = plan([tarea({ codigo: 'A-1', estado: 'open' }), tarea({ codigo: 'B-1', estado: 'open' })], []);
    expect(p.filter((x) => x.tipo === 'iniciar-tarea')).toHaveLength(1);
    expect(plan([tarea({ codigo: 'A-1', estado: 'open' }), tarea({ codigo: 'B-1', estado: 'open' })], [], { maxIniciar: 2 }).filter((x) => x.tipo === 'iniciar-tarea')).toHaveLength(2);
  });

  it('respeta el máximo de pasos y no repite', () => {
    const tareas = Array.from({ length: 6 }, (_, i) => tarea({ codigo: `T-${i}`, estado: 'open' }));
    const p = plan(tareas, [], { maxPasos: 3, maxIniciar: 6 });
    expect(p).toHaveLength(3);
    expect(new Set(p.map((x) => x.id)).size).toBe(3);
  });

  it('lo gratuito se ejecuta antes que lo ligero y lo ligero antes que lo pesado', () => {
    const p = plan([tarea({ codigo: 'GEN-01-BE' }), tarea({ codigo: 'X-1', estado: 'open' })], [pr({ numero: 7, ci: 'fallo', atrasado: true })]);
    const o = ordenDeEjecucion(p);
    const rangos = o.map((x) => (x.ejecutor === 'hilo' ? 0 : x.peso === 'ligero' ? 1 : 2));
    expect(rangos).toEqual([...rangos].sort());
  });
});

describe('modelo, tope, caché y prompts', () => {
  const paso = (peso: 'ligero' | 'completo', escritura = false) => ({ id: 'x', tipo: 'explicar-bloqueo', ref: 'X', titulo: 't', ejecutor: 'agente', salida: 'ninguna', escritura, peso, prioridad: 1 }) as const;

  it('redactar usa el modelo ligero y editar código el de desarrollo', () => {
    expect(modeloDelPaso(paso('ligero'), perfil, { modeloEscalonado: true })).toEqual(perfil.modelos.documentacion);
    expect(modeloDelPaso(paso('ligero'), perfil, { modeloEscalonado: false })).toEqual(perfil.modelos.integracion);
    expect(modeloDelPaso(paso('completo', true), perfil, { modeloEscalonado: true })).toEqual(perfil.modelos.desarrollo);
  });

  it('el tope de un paso ligero es una décima del de uno pesado', () => {
    expect(topeDelPaso(paso('completo', true), { topeUsdPaso: 1.5 })).toBe(1.5);
    expect(topeDelPaso(paso('ligero'), { topeUsdPaso: 1.5 })).toBe(0.15);
  });

  it('la clave cambia con el commit y con el texto, y no con el orden de nada más', () => {
    const p = paso('ligero');
    expect(claveDePaso(p, 'a1', 'hola')).toBe(claveDePaso(p, 'a1', 'hola'));
    expect(claveDePaso(p, 'a2', 'hola')).not.toBe(claveDePaso(p, 'a1', 'hola'));
    expect(claveDePaso(p, 'a1', 'hola!')).not.toBe(claveDePaso(p, 'a1', 'hola'));
  });

  it('el prompt de CI lleva solo el digesto y exige el cambio mínimo', () => {
    const t = promptDelPaso({ ...paso('completo', true), tipo: 'arreglar-ci', ref: '#7', tarea: 'GEN-01-BE' }, { digestoCi: '[ERROR] Tests run: 3, Failures: 1' }, perfil);
    expect(t).toContain('Tests run: 3, Failures: 1');
    expect(t).toContain('lo mínimo');
    expect(t.length).toBeLessThan(700);
  });

  it('iniciar tarea fija el tope de líneas del perfil y prohíbe datos reales', () => {
    const t = promptDelPaso({ ...paso('completo', true), tipo: 'iniciar-tarea', ref: 'X-1', tarea: 'X-1' }, { rama: 'feature/ana-X-1' }, perfil);
    expect(t).toContain(`${perfil.limites.lineasPorPr} líneas`);
    expect(t).toContain('nunca datos reales');
  });

  it('el ahorro máximo baja el tope de gasto y el modo libre lo sube', () => {
    expect(ahorroEfectivo(presetAhorro('maximo')).topeUsdPaso).toBeLessThan(ahorroEfectivo().topeUsdPaso);
    expect(ahorroEfectivo({ activo: false }).topeUsdPaso).toBeGreaterThan(ahorroEfectivo().topeUsdPaso);
    expect(ahorroEfectivo({ activo: false }).modeloEscalonado).toBe(false);
  });
});
