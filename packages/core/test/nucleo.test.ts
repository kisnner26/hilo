import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  argumentosClaude,
  argumentosCodex,
  asignar,
  cargarPerfil,
  comentarioClickup,
  conDecision,
  decidir,
  estadistica,
  estimarTokens,
  leerSubtareas,
  marcarPaso,
  modeloDeRol,
  nuevoHilo,
  conPaso,
  paqueteDeContexto,
  planificar,
  desbordes,
  recordatorio,
  textoDeEvento,
  validarComentario,
  buscarNotas,
  grafoDeBoveda,
  type Grafo,
  type Hecho,
  type Nota,
} from '../src/index.js';

const perfil = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));
const ahora = new Date('2026-11-23T12:00:00Z');

describe('comentarios de ClickUp', () => {
  it('genera la entrega con enlace, SHA, contribuciones y pendientes', () => {
    const t = comentarioClickup({
      tipo: 'entrega',
      codigo: 'BFA-BE-01',
      enlace: 'https://github.com/Nell16/sistema-evaluaciones/pull/79',
      sha: 'a2b6dfe',
      contribuciones: ['Rodrigo: módulo y pruebas'],
      hecho: ['13 subpruebas'],
      pendientes: ['testing-ok'],
    });
    expect(validarComentario(t, 'entrega', perfil, 2)).toEqual([]);
  });

  it('lista todas las faltas de una vez en vez de pedirlas una por una', () => {
    const faltas = validarComentario('ya lo subí, revisen', 'entrega', perfil, 2);
    expect(faltas).toHaveLength(4);
  });
});

describe('contexto por rol y presupuesto', () => {
  const g: Grafo = {
    nodos: [
      { id: 'a', label: 'ServicioA', tipo: 'code', archivo: 'backend/src/A.java', comunidad: 0 },
      { id: 'b', label: 'ServicioB', tipo: 'code', archivo: 'backend/src/B.java', comunidad: 0 },
      { id: 'c', label: 'config', tipo: 'yaml', archivo: 'ci.yml', comunidad: 1 },
      { id: 'd', label: 'Doc', tipo: 'doc', archivo: 'docs/x.md', comunidad: 1 },
    ],
    enlaces: [
      { origen: 'a', destino: 'b', relacion: 'llama' },
      { origen: 'a', destino: 'c', relacion: 'usa' },
    ],
  };
  it('quita el ruido y respeta el lente del rol', () => {
    const p = paqueteDeContexto(g, { alcance: { tipo: 'todo' }, rol: 'desarrollador', conciso: true, sinRuido: true, presupuesto: 1000 });
    expect(p.texto).toContain('ServicioA');
    expect(p.texto).not.toContain('config');
    expect(p.texto).not.toContain('Doc');
  });
  it('descarta librerías externas (sin archivo) y sube lo que coincide con la consulta', () => {
    const g2: Grafo = {
      nodos: [
        { id: 'x', label: 'org.junit.Test', tipo: 'code', comunidad: 0 },
        { id: 'a', label: 'ServicioA', tipo: 'code', archivo: 'backend/src/A.java', comunidad: 0 },
        { id: 'b', label: 'MotorSubpruebas', tipo: 'code', archivo: 'backend/src/Motor.java', comunidad: 0 },
      ],
      enlaces: [
        { origen: 'x', destino: 'a', relacion: 'usa' },
        { origen: 'x', destino: 'b', relacion: 'usa' },
      ],
    };
    const p = paqueteDeContexto(g2, { alcance: { tipo: 'todo' }, conciso: true, sinRuido: true, presupuesto: 1000, consulta: 'motor subpruebas' });
    expect(p.texto).not.toContain('org.junit');
    expect(p.texto.indexOf('MotorSubpruebas')).toBeLessThan(p.texto.indexOf('ServicioA'));
  });
  it('recorta por presupuesto y lo marca', () => {
    const p = paqueteDeContexto(g, { alcance: { tipo: 'todo' }, conciso: true, sinRuido: false, presupuesto: 18 });
    expect(p.recortado).toBe(true);
    expect(p.tokens).toBeLessThanOrEqual(estimarTokens(p.texto));
  });
  it('la vecindad de un nodo trae solo lo cercano', () => {
    const p = paqueteDeContexto(g, { alcance: { tipo: 'vecindad', nodo: 'b', saltos: 1 }, conciso: true, sinRuido: false, presupuesto: 1000 });
    expect(p.nodos).toBe(2);
  });
  it('busca notas Markdown y arma su grafo por [[enlaces]]', () => {
    const notas: Nota[] = [
      { ruta: 'docs/a.md', titulo: 'Reglas de omisiones', texto: 'una omisión no resta. ver [[b]]', enlaces: ['b'], carpeta: 'docs' },
      { ruta: 'docs/b.md', titulo: 'Claves', texto: 'una clave aprobada por versión', enlaces: [], carpeta: 'docs' },
    ];
    expect(buscarNotas(notas, 'omisión resta')[0]?.nota.ruta).toBe('docs/a.md');
    expect(grafoDeBoveda(notas).enlaces).toHaveLength(1);
  });
});

describe('hilo de trabajo', () => {
  it('conserva objetivo y pendientes aunque haya que recortar el historial', () => {
    let h = nuevoHilo('bfa-be-04', 'desarrollador', 'pruebas de R1 y R2', 'BFA-BE-04', ahora);
    for (let i = 0; i < 30; i++) h = conDecision(h, `decisión ${i} con un texto largo para ocupar espacio`, 'motivo largo de la decisión', ahora);
    for (let i = 0; i < 20; i++) h = marcarPaso(conPaso(h, `paso hecho ${i}`), i, ahora);
    h = conPaso(h, 'abrir PR en borrador');
    const r = recordatorio(h, 150);
    expect(r).toContain('pruebas de R1 y R2');
    expect(r).toContain('abrir PR en borrador');
    expect(estimarTokens(r)).toBeLessThanOrEqual(230);
  });
});

describe('motor de decisión', () => {
  const hechos: Hecho[] = [
    { clave: 'ci-ok', valor: true, fuente: 'gh pr checks 81', visto: ahora.toISOString(), vigenciaHoras: 1 },
    { clave: 'main-sha', valor: 'ef0317e', fuente: 'gh api commits/main', visto: '2026-11-22T00:00:00Z', vigenciaHoras: 6 },
  ];
  it('un desarrollador no puede fusionar', () => {
    expect(decidir({ tipo: 'fusionar', rol: 'desarrollador', objetivo: '#81', afirmaciones: [] }, perfil, hechos, ahora).veredicto).toBe('bloquear');
  });
  it('comentar exige aprobación humana', () => {
    const d = decidir({ tipo: 'comentar', rol: 'integrador', objetivo: '#42', afirmaciones: [] }, perfil, hechos, ahora);
    expect(d.veredicto).toBe('preguntar');
    const ok = decidir({ tipo: 'comentar', rol: 'integrador', objetivo: '#42', afirmaciones: [], humanoAprobo: true }, perfil, hechos, ahora);
    expect(ok.veredicto).toBe('permitir');
  });
  it('bloquea una afirmación que contradice un hecho registrado', () => {
    const d = decidir(
      { tipo: 'proponer', rol: 'integrador', objetivo: 'estado', afirmaciones: [{ texto: 'main está en abc1234', hechoClave: 'main-sha', valor: 'abc1234' }] },
      perfil,
      hechos,
      ahora,
    );
    expect(d.veredicto).toBe('bloquear');
    expect(d.razones[0]).toMatch(/Contradicción/);
  });
  it('pide verificar un dato vencido o sin fuente', () => {
    const d = decidir(
      { tipo: 'proponer', rol: 'integrador', objetivo: 'estado', afirmaciones: [{ texto: 'main sigue igual', hechoClave: 'main-sha', valor: 'ef0317e' }, { texto: 'hay 38 fusiones' }] },
      perfil,
      hechos,
      ahora,
    );
    expect(d.porVerificar).toHaveLength(2);
    expect(d.respaldo).toBe(0);
  });
  it('no fusiona sin Code Owner ni testing-ok cuando se exige', () => {
    const d = decidir({ tipo: 'fusionar', rol: 'integrador', objetivo: '#51', afirmaciones: [], humanoAprobo: true, codigoTarea: 'GEN-01-BE' }, perfil, hechos, ahora);
    expect(d.veredicto).toBe('bloquear');
    expect(d.razones[0]).toMatch(/aprobación de un Code Owner/);
    expect(d.razones[0]).toMatch(/testing-ok/);
  });
});

describe('reparto entre integradores', () => {
  it('reparte por carga, nunca al autor, y es estable', () => {
    const cola = [
      { numero: 1, autor: 'kisnner26', rondas: 0, lineas: 300, listo: true },
      { numero: 2, autor: 'ana', rondas: 0, lineas: 100, listo: true },
      { numero: 3, autor: 'ana', rondas: 0, lineas: 100, listo: true, integrador: 'kisnner26' },
    ];
    const a = asignar(cola, ['kisnner26', 'over2099']);
    expect(a.find((x) => x.numero === 1)?.integrador).toBe('over2099');
    // tras darle el PR 1 a over2099 (300 líneas), kisnner26 (100) queda con menos carga
    expect(a.find((x) => x.numero === 2)?.integrador).toBe('kisnner26');
    const e = estadistica([{ ...cola[0]!, rondas: 5, integrador: 'kisnner26' }, ...cola.slice(1)], ['kisnner26', 'over2099']);
    expect(e.conMasDeTresRondas).toEqual([1]);
    expect(e.concentracion).toBe(1);
  });
});

describe('plan XP de dos semanas', () => {
  it('parte lo grande, respeta dependencias y no desborda un día', () => {
    const plan = planificar(
      [
        { codigo: 'A', titulo: 'modelo', lineas: 900, dependeDe: [], rol: 'desarrollador' },
        { codigo: 'B', titulo: 'api', lineas: 300, dependeDe: ['A'], rol: 'desarrollador' },
      ],
      10,
      500,
    );
    const diaDe = (c: string) => plan.find((d) => d.piezas.some((p) => p.codigo === c))?.dia ?? 0;
    expect(plan.flatMap((d) => d.piezas).filter((p) => p.codigo === 'A')).toHaveLength(3);
    expect(diaDe('B')).toBeGreaterThan(diaDe('A'));
    expect(desbordes(plan, 500)).toEqual([]);
  });
  it('detecta dependencias circulares', () => {
    expect(() =>
      planificar(
        [
          { codigo: 'A', titulo: 'a', lineas: 10, dependeDe: ['B'], rol: 'desarrollador' },
          { codigo: 'B', titulo: 'b', lineas: 10, dependeDe: ['A'], rol: 'desarrollador' },
        ],
        5,
        100,
      ),
    ).toThrow(/circular/);
  });
});

describe('agentes por suscripción', () => {
  it('arma los argumentos de Claude Code con modelo y esfuerzo', () => {
    const a = argumentosClaude({ asignado: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' }, prompt: 'x', cwd: '.', sistema: 'rol', soloLectura: true });
    expect(a).toEqual(expect.arrayContaining(['-p', '--model', 'claude-sonnet-5-5', '--effort', 'low', '--permission-mode', 'plan']));
    expect(a).not.toContain('--api-key');
  });
  it('Codex acota el esfuerzo a lo que soporta', () => {
    const a = argumentosCodex({ asignado: { cli: 'codex', modelo: 'gpt-5', esfuerzo: 'max' }, prompt: 'x', cwd: '.' });
    expect(a).toContain('model_reasoning_effort="high"');
  });
  it('asigna el modelo por rol desde el perfil', () => {
    expect(modeloDeRol(perfil, 'documentador').modelo).toBe('claude-haiku-5-5');
    expect(perfil.modelos.orquestador.modelo).toBe('claude-opus-5-5');
  });
  it('lee subtareas válidas y descarta basura', () => {
    const t = 'Plan:\n[{"rol":"desarrollador","instruccion":"a","consulta":"b"},{"rol":"mago","instruccion":"x","consulta":"y"}]';
    expect(leerSubtareas(t)).toHaveLength(1);
    expect(leerSubtareas('sin json')).toEqual([]);
  });
  it('extrae el texto final del flujo JSON', () => {
    expect(textoDeEvento('claude', '{"type":"result","result":"listo"}')).toBe('listo');
    expect(textoDeEvento('claude', 'no json')).toBeUndefined();
  });
});

describe('agente de escritura', () => {
  const base = { asignado: { cli: 'claude' as const, modelo: 'claude-sonnet-5-5', esfuerzo: 'low' as const }, prompt: 'x', cwd: '.' };
  it('edita y prueba, pero nunca publica ni borra', () => {
    const a = argumentosClaude({ ...base, escritura: true, presupuestoUsd: 0.5 });
    expect(a).toEqual(expect.arrayContaining(['--permission-mode', 'acceptEdits', '--allowedTools', '--disallowedTools', '--max-budget-usd', '0.5']));
    expect(a).toContain('Bash(git push:*)');
    expect(a.indexOf('--disallowedTools')).toBeGreaterThan(a.indexOf('--allowedTools'));
    expect(a.slice(a.indexOf('--allowedTools'), a.indexOf('--disallowedTools'))).not.toContain('Bash(git push:*)');
  });
  it('solo lectura gana sobre escritura', () => {
    const a = argumentosClaude({ ...base, escritura: true, soloLectura: true });
    expect(a).toContain('plan');
    expect(a).not.toContain('acceptEdits');
  });
  it('un paso suelto no deja sesión guardada', () => {
    expect(argumentosClaude({ ...base, sinSesion: true })).toContain('--no-session-persistence');
    expect(argumentosClaude({ ...base, sinSesion: true, sesion: { id: 'u', reanudar: false } })).not.toContain('--no-session-persistence');
  });
  it('Codex usa su caja de escritura del espacio de trabajo', () => {
    expect(argumentosCodex({ asignado: { cli: 'codex', modelo: 'gpt-5', esfuerzo: 'low' }, prompt: 'x', cwd: '.', escritura: true })).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write']));
  });
});
