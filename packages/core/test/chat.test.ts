import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { argumentosClaude, cargarPerfil, deltaDeEvento, detectarIntencion, miDia, promptSistemaChat, promptTarea, respuestaDeIntencion, respuestaSinIa, type PrResumen, type TareaClickup } from '../src/index.js';

const perfil = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));
const ahora = new Date('2026-11-23T15:00:00Z');
const tarea = (codigo: string, extra: Partial<TareaClickup> = {}): TareaClickup => ({ id: codigo, codigo, nombre: `${codigo} — algo`, estado: 'in progress', lista: 'l', asignados: [], asignadosIds: [124365173], dependeDe: [], ...extra });
const pr = (n: number, extra: Partial<PrResumen> = {}): PrResumen => ({ numero: n, titulo: `[GEN-01-FE] catálogo`, autor: 'aleelezz', rama: 'feature/j-GEN-01-FE', borrador: true, url: `https://github.com/o/r/pull/${n}`, ci: 'fallo', revision: 'requerida', estadoFusion: 'BEHIND', pidenMiRevision: false, ...extra });
const jimmy = { github: 'aleelezz', clickupId: 124365173, clickupUsuario: 'JIMMY ALEJANDRO GALO HERNANDEZ' };
const dia = miDia([tarea('GEN-01-FE'), tarea('UI-02', { estado: 'blocked', vence: '2026-11-18T10:00:00Z' })], [pr(42)], jimmy, perfil, ahora);

describe('chat libre', () => {
  it('reconoce las preguntas que se contestan sin gastar tokens', () => {
    expect(detectarIntencion('¿Qué tarea tengo?')).toBe('mis-tareas');
    expect(detectarIntencion('que tareas me tocan hoy')).toBe('mis-tareas');
    expect(detectarIntencion('¿Qué hago hoy?')).toBe('mi-dia');
    expect(detectarIntencion('cuáles son mis PR')).toBe('mis-prs');
    expect(detectarIntencion('Hola')).toBe('saludo');
    expect(detectarIntencion('¿cómo funciona el motor de subpruebas?')).toBeNull();
  });

  it('a "qué tarea tengo" responde con sus tareas y pregunta si quiere entenderla, hacerla o revisarla', () => {
    const r = respuestaDeIntencion('mis-tareas', dia);
    expect(r.texto).toContain('2 tareas abiertas');
    expect(r.tarjetas.map((t) => t.ref)).toEqual(['GEN-01-FE', 'UI-02']);
    expect(r.tarjetas[0]?.acciones).toEqual(['entender', 'hacer', 'revisar']); // tiene PR
    expect(r.tarjetas[1]?.acciones).toEqual(['entender', 'hacer', 'bloqueo']); // bloqueada, sin PR
    expect(r.tarjetas[0]?.detalle).toContain('PR #42');
    expect(r.pregunta).toMatch(/entenderla, hacerla o revisarla/);
  });

  it('sin tareas lo dice y sugiere dónde mirar', () => {
    const vacio = miDia([], [], jimmy, perfil, ahora);
    expect(respuestaDeIntencion('mis-tareas', vacio).texto).toMatch(/qué listas de ClickUp seguir/);
  });

  it('mi día lista lo urgente con botones según el tipo', () => {
    const r = respuestaDeIntencion('mi-dia', dia);
    expect(r.tarjetas[0]?.detalle).toBe('ci');
    expect(r.tarjetas[0]?.acciones).toEqual(['revisar']);
  });

  it('el prompt de sistema lleva el rol, las tareas, los PR y el resumen, y pide cerrar con la pregunta', () => {
    const s = promptSistemaChat(perfil, dia, '## Resumen del proyecto (3 nodos)', 'Nell16/sistema-evaluaciones');
    expect(s).toContain('Jimmy');
    expect(s).toContain('GEN-01-FE (in progress)');
    expect(s).toContain('#42');
    expect(s).toContain('Resumen del proyecto');
    expect(s).toMatch(/entenderla, hacerla o revisarla/);
    expect(s).toMatch(/solo lectura/);
  });

  it('el prompt de cada acción trae los datos de la tarea y no manda a modificar archivos al hacer', () => {
    const d = { nombre: 'Catálogo', estado: 'in progress', descripcion: '## Objetivo\nMostrar tests.\n\nRelleno largo sin relación.\n\n## Criterios de aceptación\n- Lista y detalle.', comentarios: [{ autor: 'Kisnner', texto: 'usa el cliente del #45' }] };
    const hacer = promptTarea('hacer', 'GEN-01-FE', d, undefined);
    expect(hacer).toContain('No modifiques archivos todavía');
    expect(hacer).toContain('usa el cliente del #45');
    const revisar = promptTarea('revisar', 'GEN-01-FE', d, pr(42), 'ERROR [titulo] ...', '+línea nueva');
    expect(revisar).toContain('PR #42');
    expect(revisar).toContain('Revisión de formato');
    expect(revisar).toContain('+línea nueva');
    expect(promptTarea('entender', 'X-1', undefined, undefined)).toContain('Explícame la tarea X-1');
  });

  it('la conversación continúa con la sesión y el texto llega en flujo', () => {
    const base = { asignado: { cli: 'claude' as const, modelo: 'claude-sonnet-5-5', esfuerzo: 'low' as const }, prompt: 'x', cwd: '.' };
    const primera = argumentosClaude({ ...base, sesion: { id: 'u1', reanudar: false }, alTexto: () => {} });
    expect(primera).toEqual(expect.arrayContaining(['--session-id', 'u1', '--include-partial-messages']));
    expect(argumentosClaude({ ...base, sesion: { id: 'u1', reanudar: true } })).toEqual(expect.arrayContaining(['--resume', 'u1']));
    expect(deltaDeEvento('claude', JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text: 'Hola' } } }))).toBe('Hola');
    expect(deltaDeEvento('claude', JSON.stringify({ type: 'result' }))).toBeUndefined();
    expect(deltaDeEvento('codex', '{}')).toBeUndefined();
  });
});

describe('intenciones del piloto y de los bloqueos', () => {
  it('reconoce preguntas sobre quién frena, también dichas con la voz', () => {
    for (const t of ['¿Quién me bloquea?', 'quien me esta frenando', 'por qué no puedo avanzar', 'de quién dependo']) expect(detectarIntencion(t)).toBe('quien-bloquea');
  });
  it('reconoce el pedido de hacer los pendientes', () => {
    for (const t of ['hazme mis pendientes', 'prepara mis pendientes', 'haz mi día', 'piloto automático']) expect(detectarIntencion(t)).toBe('piloto');
  });
  it('no confunde preguntas normales', () => {
    expect(detectarIntencion('¿qué tarea tengo?')).toBe('mis-tareas');
    expect(detectarIntencion('explícame el modelo de datos')).toBeNull();
  });
  it('responde sin modelo con quién frena y ofrece el piloto', () => {
    const dia = { saludo: 'Ana', rol: 'desarrollador', tareas: [], prs: [], paraRevisar: [], acciones: [] } as never;
    const r = respuestaDeIntencion('quien-bloquea', dia, { bloqueos: [{ tipo: 'dependencia', tarea: 'X-1', causa: 'c', quien: ['luis'], tuTurno: false, dias: 2 }], pasosPiloto: 3 });
    expect(r.texto).toContain('**luis** frena X-1');
    expect(r.accion).toBe('piloto');
    expect(respuestaDeIntencion('quien-bloquea', dia, { bloqueos: [] }).texto).toContain('Nadie te frena');
  });
});

describe('respuesta sin IA', () => {
  const notas = [
    { ruta: 'docs/baremos.md', titulo: 'Baremos BFA', texto: 'Los baremos se aprueban con evidencia.\n\nLa conversión a percentil usa coincidencia exacta de rango.', carpeta: 'docs' },
    { ruta: 'docs/otra.md', titulo: 'Otra nota', texto: 'Nada que ver con esto.', carpeta: 'docs' },
  ] as never;
  const grafo = { nodos: [{ id: 'a', label: 'ConversionPercentilService', archivo: 'src/ConversionPercentilService.java' }], enlaces: [] };
  it('busca en las notas y en el grafo y avisa que no hay modelo', () => {
    const r = respuestaSinIa('cómo se convierte a percentil', notas, grafo);
    expect(r.texto).toContain('Baremos BFA');
    expect(r.texto).toContain('ConversionPercentilService');
    expect(r.texto).toContain('No hay un modelo de IA activo');
  });
  it('dice con honestidad cuando no encuentra nada', () => {
    expect(respuestaSinIa('zzzz qqqq', notas, grafo).texto).toContain('No encontré nada');
  });
});
