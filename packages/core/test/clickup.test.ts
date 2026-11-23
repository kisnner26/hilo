import { describe, expect, it } from 'vitest';
import { ClickUp, codigoDeNombre, nombrarComunidades, tareasAPlan, planificar, type Grafo } from '../src/index.js';

interface Llamada {
  url: string;
  metodo: string;
  auth?: string;
  cuerpo?: unknown;
}

function falso(respuestas: Record<string, unknown>, estado = 200) {
  const llamadas: Llamada[] = [];
  const f = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    llamadas.push({ url, metodo: init?.method ?? 'GET', auth: init?.headers?.Authorization, cuerpo: init?.body ? JSON.parse(init.body) : undefined });
    const clave = Object.keys(respuestas).find((k) => url.includes(k));
    return { ok: estado < 400, status: estado, json: async () => (clave ? respuestas[clave] : {}), text: async () => 'detalle del error' };
  };
  return { f, llamadas };
}

describe('cliente de ClickUp', () => {
  it('lee tareas con su código, estado, asignados, vencimiento y dependencias', async () => {
    const { f, llamadas } = falso({
      '/list/1800450000001291/task': {
        last_page: true,
        tasks: [
          { id: 'a1', name: 'BFA-BE-04 — implementar familia Razonamiento', status: { status: 'pending' }, assignees: [{ username: 'OCTAVIO' }], due_date: '1795514400000', dependencies: [{ task_id: 'a1', depends_on: 'b2' }, { task_id: 'zz', depends_on: 'a1' }] },
          { id: 'b2', name: 'GEN-03-BE — motor', status: { status: 'in progress' }, assignees: [], dependencies: [] },
        ],
      },
    });
    const ts = await new ClickUp('pk_test', f).tareasDeLista('1800450000001291');
    expect(llamadas[0]?.auth).toBe('pk_test');
    expect(ts[0]).toMatchObject({ codigo: 'BFA-BE-04', estado: 'pending', asignados: ['OCTAVIO'], dependeDe: ['b2'] });
    expect(ts[0]?.vence).toBe('2026-11-24T10:00:00.000Z');
  });

  it('publica un comentario con el cuerpo exacto y sin notificar a todos', async () => {
    const { f, llamadas } = falso({ '/comment': { id: 123 } });
    const id = await new ClickUp('pk_test', f).comentar('abc', 'Entrega BFA-BE-01');
    expect(id).toBe('123');
    expect(llamadas[0]).toMatchObject({ metodo: 'POST', cuerpo: { comment_text: 'Entrega BFA-BE-01', notify_all: false } });
  });

  it('cambia el estado con PUT', async () => {
    const { f, llamadas } = falso({ '/task/abc': {} });
    await new ClickUp('pk_test', f).cambiarEstado('abc', 'in review');
    expect(llamadas[0]).toMatchObject({ metodo: 'PUT', cuerpo: { status: 'in review' } });
  });

  it('explica el 401 y el 429 en vez de devolver un error genérico', async () => {
    await expect(new ClickUp('mal', falso({}, 401).f).yo()).rejects.toThrow(/token personal/);
    await expect(new ClickUp('x', falso({}, 429).f).yo()).rejects.toThrow(/limitó/);
    await expect(new ClickUp('x', falso({}, 500).f).yo()).rejects.toThrow(/500/);
  });

  it('el token solo viaja en la cabecera, nunca en la URL', async () => {
    const { f, llamadas } = falso({ '/user': { user: { id: 1, username: 'ana' } } });
    await new ClickUp('pk_secreto', f).yo();
    expect(llamadas[0]?.url).not.toContain('pk_secreto');
  });
});

describe('de ClickUp a un plan', () => {
  it('descarta lo cerrado, estima por tipo, asigna rol y resuelve dependencias', () => {
    const plan = tareasAPlan([
      { id: '1', codigo: 'GEN-03-BE', nombre: 'GEN-03-BE — motor', estado: 'in progress', lista: 'l', asignados: ['javier'], dependeDe: [] },
      { id: '2', codigo: 'GEN-03-TEST', nombre: 'GEN-03-TEST — probar', estado: 'in progress', lista: 'l', asignados: [], dependeDe: ['1'] },
      { id: '3', codigo: 'GEN-02-FE', nombre: 'GEN-02-FE — inicio', estado: 'completed', lista: 'l', asignados: [], dependeDe: [] },
    ]);
    expect(plan.map((t) => t.codigo)).toEqual(['GEN-03-BE', 'GEN-03-TEST']);
    expect(plan[0]).toMatchObject({ lineas: 400, rol: 'desarrollador', titulo: 'motor' });
    expect(plan[1]).toMatchObject({ lineas: 200, rol: 'tester', dependeDe: ['GEN-03-BE'] });
    const dias = planificar(plan, 10, 500);
    const dia = (c: string) => dias.find((d) => d.piezas.some((p) => p.codigo === c))?.dia ?? 0;
    expect(dia('GEN-03-TEST')).toBeGreaterThan(dia('GEN-03-BE'));
  });

  it('extrae el código del nombre', () => {
    expect(codigoDeNombre('S02-WEI-DOC-04 — Reglas')).toBe('S02-WEI-DOC-04');
    expect(codigoDeNombre('sin código')).toBeUndefined();
  });
});

describe('nombres de comunidades', () => {
  it('usa la carpeta dominante y no repite nombres', () => {
    const g: Grafo = {
      nodos: [
        { id: 'a', label: 'A', archivo: 'repo/backend/src/main/java/domain/model/A.java', comunidad: 0, nombreComunidad: 'una frase larguísima de graphify' },
        { id: 'b', label: 'B', archivo: 'repo/backend/src/main/java/domain/model/B.java', comunidad: 0 },
        { id: 'c', label: 'C', archivo: 'repo/backend/src/main/java/domain/model/C.java', comunidad: 1 },
        { id: 'd', label: 'D', comunidad: 2, nombreComunidad: 'sin archivos' },
      ],
      enlaces: [],
    };
    const nombres = nombrarComunidades(g).nodos.map((n) => n.nombreComunidad);
    expect(nombres[0]).toBe('domain/model');
    expect(nombres[2]).toBe('domain/model 2');
    expect(nombres[3]).toBe('sin archivos');
  });
});
