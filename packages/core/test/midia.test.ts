import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { cargarPerfil, estadoCi, miDia, type PrResumen, type TareaClickup } from '../src/index.js';

const perfil = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));
const ahora = new Date('2026-11-23T15:00:00Z');
const tarea = (p: Partial<TareaClickup> & { codigo: string }): TareaClickup => ({ id: p.codigo, nombre: `${p.codigo} — x`, estado: 'in progress', lista: 'l', asignados: [], asignadosIds: [], dependeDe: [], ...p });
const pr = (p: Partial<PrResumen> & { numero: number }): PrResumen => ({ titulo: `[X] ${p.numero}`, autor: 'otro', rama: 'feature/a-X', borrador: false, url: `https://github.com/o/r/pull/${p.numero}`, ci: 'ok', revision: 'requerida', estadoFusion: 'BLOCKED', pidenMiRevision: false, ...p });

const jimmy = { github: 'aleelezz', clickupId: 124365173, clickupUsuario: 'JIMMY ALEJANDRO GALO HERNANDEZ' };

describe('Mi día', () => {
  it('muestra solo las tareas de quien entró y lo saluda por su nombre', () => {
    const d = miDia(
      [tarea({ codigo: 'GEN-01-FE', asignadosIds: [124365173], asignados: ['JIMMY ALEJANDRO GALO HERNANDEZ'] }), tarea({ codigo: 'GEN-03-BE', asignadosIds: [999] }), tarea({ codigo: 'UI-02', estado: 'completed', asignadosIds: [124365173] })],
      [],
      jimmy,
      perfil,
      ahora,
    );
    expect(d.tareas.map((t) => t.codigo)).toEqual(['GEN-01-FE']);
    expect(d.saludo).toBe('Jimmy');
  });

  it('sugiere abrir el PR cuando la tarea no tiene ninguno', () => {
    const d = miDia([tarea({ codigo: 'GEN-01-FE', asignadosIds: [124365173] })], [], jimmy, perfil, ahora);
    expect(d.acciones[0]).toMatchObject({ tipo: 'abrir-pr', ref: 'GEN-01-FE' });
  });

  it('cruza la tarea con su PR por el código y deja preparado el comentario de entrega', () => {
    const d = miDia([tarea({ codigo: 'GEN-01-FE', asignadosIds: [124365173], asignados: ['JIMMY'] })], [pr({ numero: 42, titulo: '[GEN-01-FE] catálogo', autor: 'aleelezz' })], jimmy, perfil, ahora);
    const a = d.acciones.find((x) => x.tipo === 'entrega');
    expect(a?.preparado).toContain('https://github.com/o/r/pull/42');
    expect(a?.preparado).toContain('Pendiente del equipo');
  });

  it('prioriza lo que bloquea: CI roto, formato y bloqueos antes que abrir PR', () => {
    const d = miDia(
      [tarea({ codigo: 'BFA-FE-04', asignadosIds: [124365173], estado: 'blocked' }), tarea({ codigo: 'BFA-FE-03', asignadosIds: [124365173] })],
      [pr({ numero: 7, titulo: '[GEN-01-FE] x', autor: 'aleelezz', ci: 'fallo', erroresDeFormato: 3 })],
      jimmy,
      perfil,
      ahora,
    );
    expect(d.acciones.map((a) => a.tipo).slice(0, 3)).toEqual(['ci', 'formato', 'bloqueo']);
  });

  it('avisa de lo vencido y de lo que espera a otra tarea', () => {
    const d = miDia(
      [tarea({ codigo: 'UI-02', asignadosIds: [124365173], vence: '2026-11-18T10:00:00Z' }), tarea({ codigo: 'GEN-04-FE', asignadosIds: [124365173], dependeDe: ['GEN-04-BE'] }), tarea({ codigo: 'GEN-04-BE', estado: 'in progress' })],
      [],
      jimmy,
      perfil,
      ahora,
    );
    expect(d.acciones.some((a) => a.tipo === 'vencida' && a.ref === 'UI-02')).toBe(true);
    expect(d.acciones.some((a) => a.tipo === 'espera' && /GEN-04-BE/.test(a.texto))).toBe(true);
  });

  it('un integrador ve los PR de otros por revisar; un desarrollador solo si se la piden', () => {
    const prs = [pr({ numero: 1, autor: 'ana' }), pr({ numero: 2, autor: 'ana', borrador: true }), pr({ numero: 3, autor: 'ana', pidenMiRevision: true })];
    const integrador = miDia([], prs, { github: 'kisnner26', clickupUsuario: 'KISNNER OBANDO' }, perfil, ahora);
    expect(integrador.rol).toBe('integrador');
    expect(integrador.paraRevisar.map((p) => p.numero)).toEqual([1, 3]);
    const dev = miDia([tarea({ codigo: 'GEN-01-FE', asignadosIds: [124365173] })], prs, jimmy, perfil, ahora);
    expect(dev.rol).toBe('desarrollador');
    expect(dev.acciones.filter((a) => a.tipo === 'revisar').map((a) => a.ref)).toEqual(['#3']);
  });

  it('el rol sale de las tareas y se puede forzar', () => {
    const t = [tarea({ codigo: 'GEN-01-TEST', asignadosIds: [124365173] }), tarea({ codigo: 'BFA-TEST-01', asignadosIds: [124365173] })];
    expect(miDia(t, [], jimmy, perfil, ahora).rol).toBe('tester');
    expect(miDia(t, [], jimmy, perfil, ahora, 'documentador').rol).toBe('documentador');
  });
});

describe('estado del CI', () => {
  it('ignora testing-ok y ci-ok, que dependen de una etiqueta', () => {
    expect(estadoCi([{ name: 'reglas', conclusion: 'SUCCESS' }, { name: 'backend-build', conclusion: 'SUCCESS' }, { name: 'testing-ok', conclusion: 'FAILURE' }, { name: 'ci-ok', conclusion: 'FAILURE' }])).toBe('ok');
    expect(estadoCi([{ name: 'reglas', conclusion: 'FAILURE' }])).toBe('fallo');
    expect(estadoCi([{ name: 'frontend-build', status: 'IN_PROGRESS' }])).toBe('pendiente');
  });
});
