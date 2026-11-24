import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { analizarBloqueos, cargarPerfil, merecePedirAvance, quienMeBloquea, type PrResumen, type TareaClickup } from '../src/index.js';

const perfil = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));
const ahora = new Date('2026-11-24T12:00:00Z');
const yo = { github: 'ana-dev', clickupId: 1, clickupUsuario: 'ANA' };
const tarea = (p: Partial<TareaClickup> & { codigo: string }): TareaClickup => ({ id: p.codigo, nombre: `${p.codigo} — x`, estado: 'in progress', lista: 'l', asignados: ['ANA'], asignadosIds: [1], dependeDe: [], ...p });
const pr = (p: Partial<PrResumen> & { numero: number }): PrResumen => ({ titulo: `[GEN-01-BE] x`, autor: 'ana-dev', rama: 'feature/ana-GEN-01-BE', borrador: false, url: 'https://github.com/o/r/pull/1', ci: 'ok', revision: 'requerida', estadoFusion: 'BLOCKED', pidenMiRevision: false, ...p });

describe('quién te bloquea', () => {
  it('nombra a quien debe una dependencia abierta', () => {
    const base = tarea({ codigo: 'GEN-01-BE' });
    const dep = tarea({ codigo: 'GEN-00-API', id: 'api', estado: 'in progress', asignados: ['LUIS'], asignadosIds: [2] });
    const b = analizarBloqueos([tarea({ codigo: 'BFA-FE-01', dependeDe: ['api'] }), dep, base], [], yo, perfil, ahora);
    expect(b[0]).toMatchObject({ tipo: 'dependencia', tarea: 'BFA-FE-01', quien: ['LUIS'], tuTurno: false });
    expect(b[0]!.recordatorio).toContain('GEN-00-API');
    expect(merecePedirAvance(b[0]!)).toBe(true);
  });

  it('ignora una dependencia que ya se cerró', () => {
    const dep = tarea({ codigo: 'GEN-00-API', id: 'api', estado: 'completed', asignados: ['LUIS'], asignadosIds: [2] });
    expect(analizarBloqueos([tarea({ codigo: 'BFA-FE-01', dependeDe: ['api'] }), dep], [], yo, perfil, ahora)).toEqual([]);
  });

  it('pide escribir la causa cuando está bloqueada sin dependencia que lo explique', () => {
    const b = analizarBloqueos([tarea({ codigo: 'GEN-06-BE', estado: 'blocked' })], [], yo, perfil, ahora);
    expect(b[0]).toMatchObject({ tipo: 'estado-bloqueada', tuTurno: true });
  });

  it('un PR en espera apunta a los revisores pedidos y cuenta los días', () => {
    const p = pr({ numero: 5, revisoresPedidos: ['kisnner26'], actualizado: '2026-11-21T12:00:00Z' });
    const b = analizarBloqueos([tarea({ codigo: 'GEN-01-BE' })], [p], yo, perfil, ahora);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ tipo: 'espera-revision', quien: ['kisnner26'], dias: 3, canal: 'github' });
    expect(b[0]!.recordatorio).toContain('@kisnner26');
    expect(merecePedirAvance(b[0]!)).toBe(true);
  });

  it('sin revisores pedidos, el aviso va a los integradores del perfil', () => {
    const b = analizarBloqueos([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 5, actualizado: '2026-11-20T12:00:00Z' })], yo, perfil, ahora);
    expect(b[0]!.quien).toEqual(perfil.integradores);
  });

  it('no insiste a quien acaba de recibir el PR', () => {
    const b = analizarBloqueos([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 5, actualizado: '2026-11-24T10:00:00Z' })], yo, perfil, ahora);
    expect(merecePedirAvance(b[0]!)).toBe(false);
  });

  it('si el CI falló o piden cambios, el turno es tuyo y no se pide revisión', () => {
    const b = analizarBloqueos([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 5, ci: 'fallo', cambiosPedidosPor: ['over2099'] })], yo, perfil, ahora);
    expect(b.map((x) => x.tipo).sort()).toEqual(['cambios-pedidos', 'ci']);
    expect(b.every((x) => x.tuTurno)).toBe(true);
  });

  it('señala testing cuando todo lo demás está en verde', () => {
    const b = analizarBloqueos([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 5, revision: 'aprobado', checksFaltantes: ['testing-ok', 'ci-ok'], sha: 'abcdef1234' })], yo, perfil, ahora);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ tipo: 'espera-testing', quien: ['Testing'] });
    expect(b[0]!.recordatorio).toContain('abcdef1');
  });

  it('la rama atrasada la resuelve Hilo solo', () => {
    const b = analizarBloqueos([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 5, atrasado: true, borrador: true })], yo, perfil, ahora);
    expect(b[0]).toMatchObject({ tipo: 'rama-atrasada', automatico: 'actualizar-rama', tuTurno: true });
  });

  it('un PR de otra persona no cuenta como bloqueo propio', () => {
    expect(analizarBloqueos([tarea({ codigo: 'GEN-01-BE' })], [pr({ numero: 5, autor: 'otro', ci: 'fallo' })], yo, perfil, ahora)).toEqual([]);
  });

  it('agrupa por persona y pone primero a quien frena más tareas', () => {
    const deps = [
      tarea({ codigo: 'A-1', id: 'a', asignados: ['LUIS'], asignadosIds: [2] }),
      tarea({ codigo: 'B-1', id: 'b', asignados: ['LUIS', 'MARTA'], asignadosIds: [2, 3] }),
    ];
    const b = analizarBloqueos([tarea({ codigo: 'X-1', dependeDe: ['a'] }), tarea({ codigo: 'X-2', dependeDe: ['b'] }), ...deps], [], yo, perfil, ahora);
    const q = quienMeBloquea(b);
    expect(q[0]).toMatchObject({ quien: 'LUIS', tareas: ['X-1', 'X-2'] });
    expect(q[1]!.quien).toBe('MARTA');
  });
});
