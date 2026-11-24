import type { EnlaceVista, NodoVista } from './galaxy';
import { grafoDemo } from './demo';

export interface Informe {
  ok: boolean;
  errores: { regla: string; mensaje: string; arreglo?: string }[];
  avisos: { regla: string; mensaje: string; arreglo?: string }[];
  verificaciones: string[];
  lineas: number;
}
export interface EstadoSesion {
  cli: 'claude' | 'codex';
  instalado: boolean;
  conectado: boolean;
  detalle: string;
}
export interface ModeloAsignado {
  cli: 'claude' | 'codex';
  modelo: string;
  esfuerzo: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}
export type Funcion = 'orquestador' | 'desarrollo' | 'documentacion' | 'integracion' | 'testing' | 'asistente';
export interface Config {
  perfil?: string;
  grafo?: string;
  boveda?: string;
  proyecto?: string;
  raiz?: string;
  repo?: string;
  modelos?: Partial<Record<Funcion, ModeloAsignado>>;
  permitirEditar?: boolean;
  ahorro?: Partial<AhorroVista>;
}
export interface PerfilVista {
  name: string;
  modelos: Record<Funcion, ModeloAsignado>;
  limites: { lineasPorPr: number };
}
export interface Paso {
  texto: string;
  hecho: boolean;
}
export interface HiloVista {
  id: string;
  rol: string;
  objetivo: string;
  tarea?: string;
  plan: Paso[];
  decisiones: { fecha: string; texto: string; motivo: string }[];
  abiertas: string[];
  prohibido: string[];
  actualizado: string;
}
export interface EventoAgente {
  fase: 'orquestador' | 'subagente' | 'fin';
  estado: 'inicio' | 'fin' | 'error';
  rol?: string;
  texto: string;
  modelo?: string;
  subtareas?: number;
  ms?: number;
}

export interface NotaVista {
  ruta: string;
  titulo: string;
  carpeta: string;
  resumen: string;
  palabras: number;
}
export interface RevisionVista {
  numero: number;
  titulo: string;
  autor: string;
  url: string;
  ci: string;
  lineas: number;
  errores: number;
  avisos: number;
  hallazgos: { gravedad: 'ERROR' | 'AVISO'; regla: string; mensaje: string; arreglo?: string }[];
  comentario: string;
}
export interface ProgramadaVista {
  id: 'avisos' | 'resumen-dia' | 'revisar-prs' | 'informe-cola' | 'autopiloto';
  activo: boolean;
  cadaMin?: number;
  hora?: string;
  ultima?: string;
  resultado?: string;
}
export interface AhorroVista {
  activo: boolean;
  resumen: boolean;
  alcance: boolean;
  extractos: boolean;
  estiloBreve: boolean;
  comprimirLogs: boolean;
  sesionContinua: boolean;
  respuestasInmediatas: boolean;
  modeloEscalonado: boolean;
  cachePasos: boolean;
  topeUsdPaso: number;
  presupuesto: number;
  maxSubagentes: number;
  maxLineasDiff: number;
  maxCaracteresNota: number;
}
export interface Conexion {
  /** Solo el creador del proyecto ve las descargas. */
  creador?: boolean;
  github: { conectado: boolean; login?: string; nombre?: string; origen?: 'gh' | 'token'; ghInstalado?: boolean; error?: string };
  clickup: { conectado: boolean; usuario?: string; error?: string };
  repos: string[];
  repo: string;
  avisos: boolean;
  rol?: string;
}
export interface Prueba {
  grupo: string;
  nombre: string;
  estado: 'ok' | 'aviso' | 'error';
  detalle: string;
  ayuda?: string;
}
export interface TarjetaVista {
  tipo: 'tarea' | 'pr' | 'accion';
  titulo: string;
  detalle: string;
  ref: string;
  acciones: ('entender' | 'hacer' | 'revisar' | 'bloqueo')[];
}
export interface EventoChat {
  conv: string;
  tipo: 'respuesta' | 'inicio' | 'delta' | 'fin' | 'error';
  texto?: string;
  tarjetas?: TarjetaVista[];
  pregunta?: string;
  modelo?: string;
  ms?: number;
}
export interface PaqueteVista {
  texto: string;
  tokens: number;
  tokensTodo: number;
  ahorro: number;
  nodos?: number;
  recortado?: boolean;
}
export interface TareaVista {
  id: string;
  codigo: string;
  nombre: string;
  estado: string;
  asignados: string[];
  vence?: string;
  dependeDe: string[];
}
export interface PrVista {
  numero: number;
  titulo: string;
  autor: string;
  rama: string;
  borrador: boolean;
  url: string;
  ci: 'ok' | 'fallo' | 'pendiente';
  revision: 'aprobado' | 'cambios' | 'requerida' | 'ninguna';
  estadoFusion: string;
  pidenMiRevision: boolean;
  erroresDeFormato?: number;
}
export interface Sugerencia {
  prioridad: number;
  tipo: 'ci' | 'formato' | 'revision-recibida' | 'bloqueo' | 'vencida' | 'abrir-pr' | 'entrega' | 'revisar' | 'espera';
  texto: string;
  ref: string;
  preparado?: string;
}
export interface MiDiaVista {
  saludo: string;
  rol: string;
  tareas: TareaVista[];
  prs: PrVista[];
  paraRevisar: PrVista[];
  acciones: Sugerencia[];
}
export interface ColaVista {
  cola: { numero: number; autor: string; rondas: number; lineas: number; listo: boolean }[];
  asignaciones: { numero: number; integrador: string; motivo: string }[];
  metricas: { prs: number; rondasPromedio: number; conMasDeTresRondas: number[]; cargaPorIntegrador: Record<string, number>; concentracion: number };
  integradores: string[];
}
export interface PlanVista {
  plan: { dia: number; piezas: { codigo: string; pieza: string; lineas: number; rol: string }[]; integracion: string }[];
  desbordes: number[];
  tareas: number;
}
export interface InstalacionesVista {
  repo: string;
  releases: { tag: string; publicado: string; total: number; activos: { nombre: string; descargas: number }[] }[];
}

export interface BloqueoVista {
  tipo: 'dependencia' | 'ci' | 'cambios-pedidos' | 'espera-revision' | 'espera-testing' | 'rama-atrasada' | 'estado-bloqueada';
  tarea: string;
  pr?: number;
  causa: string;
  quien: string[];
  tuTurno: boolean;
  dias: number;
  automatico?: 'actualizar-rama';
}
export interface CulpableVista {
  quien: string;
  bloqueos: number;
  tareas: string[];
  masAntiguo: number;
}
export interface PasoAutoVista {
  id: string;
  tipo: string;
  ref: string;
  titulo: string;
  ejecutor: 'hilo' | 'agente';
  salida: 'ninguna' | 'comentario-github' | 'comentario-clickup' | 'rama-y-pr' | 'push' | 'editar-pr';
  escritura: boolean;
  peso: 'ligero' | 'completo';
  prioridad: number;
}
export interface ItemBandejaVista {
  id: string;
  corrida: string;
  paso: PasoAutoVista;
  estado: 'listo' | 'publicado' | 'descartado' | 'error';
  texto: string;
  creado: string;
  modelo?: string;
  costoUsd?: number;
  detalle?: { resumen?: string; rama?: string; verificacion?: string; titulo?: string; pendientesFormato?: number; archivos?: string[] };
  enlace?: string;
}
export interface PlanAutoVista {
  bloqueos: BloqueoVista[];
  culpables: CulpableVista[];
  pasos: PasoAutoVista[];
  corriendo?: string;
}
export interface EventoAuto {
  corrida: string;
  tipo: 'inicio' | 'paso' | 'delta' | 'fin';
  id?: string;
  estado?: 'corriendo' | 'listo' | 'publicado' | 'error' | 'omitido';
  texto?: string;
  total?: number;
  listos?: number;
  item?: ItemBandejaVista;
}
export interface UsoVista {
  pasos: number;
  locales: number;
  entrada: number;
  salida: number;
  cacheLeida: number;
  costoUsd: number;
  porTecnica: { tecnica: string; tokens: number; veces: number }[];
  tokensEvitados: number;
  tokensSinHilo: number;
  ahorro: number;
  ultimos: { fecha: string; paso: string; ref: string; modelo: string; local: boolean; tokens: number; costoUsd: number }[];
}

declare global {
  interface Window {
    hilo?: { plataforma?: string; invocar: (canal: string, ...args: unknown[]) => Promise<unknown>; alEvento: (cb: (e: unknown) => void) => () => void; alCodigo: (cb: (e: unknown) => void) => () => void; alChat: (cb: (e: unknown) => void) => () => void; alAuto: (cb: (e: unknown) => void) => () => void };
  }
}

/** Con ?demo en la dirección, la app usa datos de demostración aunque corra en Electron (para capturas y pruebas). */
const demoForzada = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
export const enElectron = typeof window !== 'undefined' && Boolean(window.hilo) && !demoForzada;
const inv = <T>(canal: string, ...a: unknown[]) => window.hilo!.invocar(canal, ...a) as Promise<T>;

interface GrafoCrudo {
  nodos: { id: string; label: string; tipo?: string; archivo?: string; comunidad?: number; nombreComunidad?: string }[];
  enlaces: EnlaceVista[];
}

const PASOS_DEMO: PasoAutoVista[] = [
  { id: 'actualizar-rama:#82', tipo: 'actualizar-rama', ref: '#82', titulo: 'Actualizar la rama del #82', ejecutor: 'hilo', salida: 'ninguna', escritura: false, peso: 'ligero', prioridad: 1 },
  { id: 'arreglar-ci:#88', tipo: 'arreglar-ci', ref: '#88', titulo: 'Arreglar el CI del #88', ejecutor: 'agente', salida: 'push', escritura: true, peso: 'completo', prioridad: 2 },
  { id: 'explicar-bloqueo:BFA-FE-01', tipo: 'explicar-bloqueo', ref: 'BFA-FE-01', titulo: 'Explicar el bloqueo de BFA-FE-01', ejecutor: 'hilo', salida: 'comentario-clickup', escritura: false, peso: 'ligero', prioridad: 3 },
  { id: 'iniciar-tarea:GEN-04-FE', tipo: 'iniciar-tarea', ref: 'GEN-04-FE', titulo: 'Hacer la primera pieza de GEN-04-FE', ejecutor: 'agente', salida: 'rama-y-pr', escritura: true, peso: 'completo', prioridad: 4 },
  { id: 'entregar:GEN-01-BE', tipo: 'entregar', ref: 'GEN-01-BE', titulo: 'Comentar la entrega de GEN-01-BE', ejecutor: 'hilo', salida: 'comentario-clickup', escritura: false, peso: 'ligero', prioridad: 5 },
  { id: 'avisar:espera-revision:88', tipo: 'avisar', ref: '#88', titulo: 'Avisar a over2099: El #88 espera su revisión desde hace 3 días', ejecutor: 'hilo', salida: 'comentario-github', escritura: false, peso: 'ligero', prioridad: 7 },
];
const PLAN_DEMO: PlanAutoVista = {
  pasos: PASOS_DEMO,
  bloqueos: [
    { tipo: 'espera-revision', tarea: 'GEN-01-BE', pr: 88, causa: 'El #88 espera la revisión de over2099 desde hace 3 días.', quien: ['over2099'], tuTurno: false, dias: 3 },
    { tipo: 'dependencia', tarea: 'BFA-FE-01', causa: 'Depende de GEN-00-API (in progress).', quien: ['luis-dev'], tuTurno: false, dias: 0 },
    { tipo: 'dependencia', tarea: 'GEN-04-FE', causa: 'Depende de GEN-04-BE (in review).', quien: ['luis-dev'], tuTurno: false, dias: 0 },
    { tipo: 'espera-testing', tarea: 'GEN-01-BE', pr: 88, causa: 'Al #88 le falta testing-ok: Testing debe dar conformidad.', quien: ['Testing'], tuTurno: false, dias: 2 },
    { tipo: 'ci', tarea: 'GEN-03-FE', pr: 91, causa: 'El CI del #91 falló.', quien: [], tuTurno: true, dias: 1 },
  ],
  culpables: [
    { quien: 'luis-dev', bloqueos: 2, tareas: ['BFA-FE-01', 'GEN-04-FE'], masAntiguo: 0 },
    { quien: 'over2099', bloqueos: 1, tareas: ['GEN-01-BE'], masAntiguo: 3 },
    { quien: 'Testing', bloqueos: 1, tareas: ['GEN-01-BE'], masAntiguo: 2 },
  ],
};
const BANDEJA_DEMO: ItemBandejaVista[] = [
  { id: 'b1', corrida: 'c', paso: PASOS_DEMO[2]!, estado: 'listo', creado: new Date().toISOString(), texto: 'Bloqueo BFA-FE-01\n\nCausa: Depende de GEN-00-API (in progress).\nSe desbloquea con: que luis-dev cierre lo pendiente o confirme una fecha.\nDepende de: luis-dev' },
  { id: 'b2', corrida: 'c', paso: PASOS_DEMO[4]!, estado: 'listo', creado: new Date().toISOString(), texto: 'Entrega GEN-01-BE\n\nEnlace: https://github.com/org/repo/pull/88\nSHA probado: 3da3156\n\nPendiente del equipo (Integración, Testing, Documentación):\n- testing-ok y revisión de Integración' },
  { id: 'b3', corrida: 'c', paso: PASOS_DEMO[1]!, estado: 'listo', creado: new Date().toISOString(), modelo: 'claude-sonnet-5-5 · low', costoUsd: 0.12, texto: 'Causa: la prueba esperaba el rango cerrado y el servicio devolvía abierto. Cambié el límite superior y agregué el caso del extremo compartido. Pasó mvn spotless:check.', detalle: { resumen: '2 archivo(s), 31 líneas, 1 commit(s)', rama: 'feature/ana-dev-GEN-01-BE', verificacion: 'Pasó: mvn -f backend/pom.xml spotless:check', archivos: ['backend/src/main/java/Servicio.java', 'backend/src/test/java/ServicioTest.java'] } },
];
const USO_DEMO: UsoVista = {
  pasos: 14,
  locales: 6,
  entrada: 38_400,
  salida: 6_100,
  cacheLeida: 112_000,
  costoUsd: 0.84,
  porTecnica: [
    { tecnica: 'registro-ci', tokens: 74_200, veces: 3 },
    { tecnica: 'diff', tokens: 41_300, veces: 5 },
    { tecnica: 'paso-local', tokens: 31_500, veces: 6 },
    { tecnica: 'revision', tokens: 22_800, veces: 2 },
    { tecnica: 'cache-de-paso', tokens: 12_400, veces: 2 },
  ],
  tokensEvitados: 182_200,
  tokensSinHilo: 332_600,
  ahorro: 0.55,
  ultimos: [
    { fecha: new Date().toISOString(), paso: 'arreglar-ci', ref: '#88', modelo: 'claude-sonnet-5-5 · low', local: false, tokens: 9_800, costoUsd: 0.12 },
    { fecha: new Date().toISOString(), paso: 'entregar', ref: 'GEN-01-BE', modelo: '-', local: true, tokens: 0, costoUsd: 0 },
  ],
};

const MODELOS_DEMO: PerfilVista['modelos'] = {
  orquestador: { cli: 'claude', modelo: 'claude-opus-5-5', esfuerzo: 'medium' },
  desarrollo: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' },
  documentacion: { cli: 'claude', modelo: 'claude-haiku-5-5', esfuerzo: 'low' },
  integracion: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' },
  testing: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' },
  asistente: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' },
};

/** En el navegador (sin Electron) responde con datos de demostración para poder ver y probar la interfaz. */
const DEMO_DIA: MiDiaVista = {
  saludo: 'Ana',
  rol: 'desarrollador',
  tareas: [
    { id: '1', codigo: 'GEN-01-FE', nombre: 'GEN-01-FE — catálogo y detalle', estado: 'in progress', asignados: ['ANA PEREZ'], dependeDe: [] },
    { id: '2', codigo: 'UI-02', nombre: 'UI-02 — navegación y flujo', estado: 'Open', asignados: ['ANA PEREZ'], vence: '2026-11-18T10:00:00Z', dependeDe: [] },
    { id: '3', codigo: 'GEN-04-FE', nombre: 'GEN-04-FE — finalización', estado: 'Open', asignados: ['ANA PEREZ'], dependeDe: ['x'] },
  ],
  prs: [{ numero: 42, titulo: '[GEN-01-FE] catálogo de tests', autor: 'ana-dev', rama: 'feature/ana-GEN-01-FE', borrador: true, url: 'https://github.com/Nell16/sistema-evaluaciones/pull/42', ci: 'fallo', revision: 'requerida', estadoFusion: 'BEHIND', pidenMiRevision: false, erroresDeFormato: 2 }],
  paraRevisar: [],
  acciones: [
    { prioridad: 1, tipo: 'ci', texto: 'El CI del #42 falló: corrígelo antes de pedir revisión.', ref: '#42' },
    { prioridad: 2, tipo: 'formato', texto: 'El #42 tiene 2 error(es) de formato: corrígelos de una vez.', ref: '#42' },
    { prioridad: 3, tipo: 'vencida', texto: 'UI-02 venció el 2026-11-18: entrega o avisa una fecha nueva.', ref: 'UI-02' },
    { prioridad: 5, tipo: 'entrega', texto: 'GEN-01-FE tiene el PR #42 pero sigue en "in progress": comenta la entrega.', ref: 'GEN-01-FE', preparado: 'Entrega GEN-01-FE\n\nEnlace: https://github.com/Nell16/sistema-evaluaciones/pull/42\nSHA probado: FALTA\n\nContribución de cada participante:\n- ANA PEREZ\n\nPendiente del equipo (Integración, Testing, Documentación):\n- testing-ok y revisión de Integración' },
    { prioridad: 6, tipo: 'espera', texto: 'GEN-04-FE espera a GEN-04-BE.', ref: 'GEN-04-FE' },
  ],
};

/** Sin Electron (navegador): respuestas de demostración con el mismo flujo de eventos. */
const oyentesChat = new Set<(e: EventoChat) => void>();
function chatDemo(p: { conv: string; texto?: string; tarea?: { accion: string; ref: string } }): void {
  const emitir = (e: Omit<EventoChat, 'conv'>, ms = 0) => setTimeout(() => oyentesChat.forEach((f) => f({ conv: p.conv, ...e })), ms);
  const t = (p.texto ?? '').toLowerCase();
  if (/tarea/.test(t) && /(que|qué)/.test(t)) {
    emitir({
      tipo: 'respuesta',
      texto: 'Tienes 3 tareas abiertas como desarrollador:',
      tarjetas: DEMO_DIA.tareas.map((x) => ({ tipo: 'tarea', titulo: `${x.codigo} · ${x.nombre.replace(/^[A-Z0-9-]+\s*[—–-]\s*/, '')}`, detalle: `${x.estado}${x.vence ? ` · vence ${x.vence.slice(0, 10)}` : ''}`, ref: x.codigo, acciones: x.codigo === 'GEN-01-FE' ? ['entender', 'hacer', 'revisar'] : ['entender', 'hacer'] })),
      pregunta: '¿Con cuál empezamos? Dime si quieres entenderla, hacerla o revisarla.',
    }, 300);
    return;
  }
  const respuesta = p.tarea ? `**${p.tarea.accion}** ${p.tarea.ref}: (demostración) aquí el agente respondería con el plan, usando la descripción de ClickUp y el código del repositorio.` : 'Esta es una respuesta de demostración. En la app de escritorio, el agente de tu rol responde con tus tareas, tus PR y el código del proyecto.';
  emitir({ tipo: 'inicio', modelo: 'claude-sonnet-5-5 · low' }, 100);
  respuesta.split(' ').forEach((w, i) => emitir({ tipo: 'delta', texto: `${w} ` }, 250 + i * 35));
  emitir({ tipo: 'fin', texto: respuesta, ms: 1400 }, 300 + respuesta.split(' ').length * 35);
}

export const api = {
  autoPlan: (): Promise<PlanAutoVista> => (enElectron ? inv('auto:plan') : Promise.resolve(PLAN_DEMO)),
  autoBandeja: (): Promise<ItemBandejaVista[]> => (enElectron ? inv('auto:bandeja') : Promise.resolve(BANDEJA_DEMO)),
  autoCorrer: (ids?: string[]): Promise<{ corrida: string; pasos: number }> => (enElectron ? inv('auto:correr', ids) : Promise.resolve({ corrida: 'demo', pasos: PLAN_DEMO.pasos.length })),
  autoPublicar: (ids: string[]): Promise<{ publicados: number; errores: string[] }> => (enElectron ? inv('auto:publicar', ids) : Promise.resolve({ publicados: ids.length, errores: [] })),
  autoDescartar: (ids: string[]): Promise<void> => (enElectron ? inv('auto:descartar', ids) : Promise.resolve()),
  autoCancelar: (): Promise<void> => (enElectron ? inv('auto:cancelar') : Promise.resolve()),
  alAuto: (cb: (e: EventoAuto) => void): (() => void) => (enElectron ? window.hilo!.alAuto((e) => cb(e as EventoAuto)) : () => {}),
  usoResumen: (): Promise<UsoVista> => (enElectron ? inv('uso:resumen') : Promise.resolve(USO_DEMO)),
  chatEnviar: (p: { conv: string; texto?: string; tarea?: { accion: string; ref: string } }): void => {
    if (enElectron) void inv('chat:enviar', p);
    else chatDemo(p);
  },
  chatNueva: (conv: string): Promise<void> => (enElectron ? inv('chat:nueva', conv) : Promise.resolve()),
  alChat: (cb: (e: EventoChat) => void): (() => void) => {
    if (enElectron) return window.hilo!.alChat((e) => cb(e as EventoChat));
    oyentesChat.add(cb);
    return () => void oyentesChat.delete(cb);
  },
  conexion: (): Promise<Conexion> => {
    if (enElectron) return inv('conexion:estado');
    const q = new URLSearchParams(location.search);
    const conectado = !q.has('desconectado');
    return Promise.resolve({
      github: conectado ? { conectado: true, login: 'ana-dev', nombre: 'Ana Pérez', origen: 'gh', ghInstalado: true } : { conectado: false, ghInstalado: true },
      clickup: conectado ? { conectado: true, usuario: 'ANA PEREZ' } : { conectado: false },
      repos: ['Nell16/sistema-evaluaciones'],
      repo: 'Nell16/sistema-evaluaciones',
      avisos: true,
      ...(q.get('rol') ? { rol: q.get('rol')! } : {}),
    });
  },
  githubToken: (t: string): Promise<{ login: string; nombre: string }> => inv('github:token', t),
  githubBorrarToken: (): Promise<void> => inv('github:borrar-token'),
  diagnostico: (): Promise<Prueba[]> =>
    enElectron
      ? inv('diagnostico:correr')
      : Promise.resolve([
          { grupo: 'Herramientas', nombre: 'GitHub CLI', estado: 'ok', detalle: '/opt/homebrew/bin/gh' },
          { grupo: 'GitHub', nombre: 'Cuenta', estado: 'ok', detalle: 'ana-dev · token de gh' },
          { grupo: 'ClickUp', nombre: 'Cuenta', estado: 'error', detalle: 'Sin conectar.', ayuda: 'Pega tu token personal en Ajustes, Conexiones.' },
        ]),
  resumen: (): Promise<PaqueteVista> => (enElectron ? inv('contexto:resumen') : Promise.resolve({ texto: '## Resumen del proyecto (demo)', tokens: 420, tokensTodo: 9800, ahorro: 0.96 })),
  sesionNueva: (hiloId?: string): Promise<{ texto: string; tokens: number }> => (enElectron ? inv('contexto:sesion-nueva', hiloId) : Promise.resolve({ texto: 'demo', tokens: 10 })),
  conectarGithub: (): Promise<{ login?: string }> => inv('github:conectar'),
  alCodigo: (cb: (e: { codigo: string; url: string }) => void): (() => void) => (enElectron ? window.hilo!.alCodigo((e) => cb(e as { codigo: string; url: string })) : () => {}),
  agregarRepo: (t: string): Promise<string[]> => inv('repos:agregar', t),
  elegirRepo: (r: string): Promise<void> => inv('repos:elegir', r),
  quitarRepo: (r: string): Promise<string[]> => inv('repos:quitar', r),
  clickupToken: (t: string): Promise<{ id: number; usuario: string }> => inv('clickup:token', t),
  clickupBorrar: (): Promise<void> => inv('clickup:borrar'),
  clickupListas: (): Promise<{ listas: { id: string; nombre: string; espacio: string }[]; elegidas: string[] }> => inv('clickup:listas'),
  elegirListas: (ids: string[]): Promise<void> => inv('clickup:elegir-listas', ids),
  avisos: (v: boolean): Promise<void> => inv('avisos:fijar', v),
  fijarRol: (r?: string): Promise<void> => inv('rol:fijar', r),
  miDia: (): Promise<{ dia: MiDiaVista; avisosDeConexion: string[] }> => (enElectron ? inv('midia:cargar') : Promise.resolve({ dia: DEMO_DIA, avisosDeConexion: [] })),
  cola: (): Promise<ColaVista> =>
    enElectron
      ? inv('cola:cargar')
      : Promise.resolve({ cola: [{ numero: 79, autor: 'luis-dev', rondas: 3, lineas: 521, listo: true }, { numero: 42, autor: 'ana-dev', rondas: 2, lineas: 400, listo: false }], asignaciones: [{ numero: 79, integrador: 'over2099', motivo: 'menor carga' }], metricas: { prs: 2, rondasPromedio: 2.5, conMasDeTresRondas: [], cargaPorIntegrador: { kisnner26: 5, over2099: 0 }, concentracion: 1 }, integradores: ['kisnner26', 'over2099'] }),
  plan: (o: { dias: number; capacidad: number }): Promise<PlanVista> =>
    enElectron
      ? inv('plan:generar', o)
      : Promise.resolve({ tareas: 24, desbordes: [], plan: [1, 2, 3, 4, 5].map((d) => ({ dia: d, integracion: '', piezas: [{ codigo: `GEN-0${d}-BE`, pieza: 'pieza', lineas: 300, rol: 'desarrollador' }, { codigo: `GEN-0${d}-TEST`, pieza: 'pruebas', lineas: 200, rol: 'tester' }] })) }),
  publicarGithub: (numero: string, texto: string): Promise<{ publicado: boolean; enlace?: string }> => inv('publicar:github', { numero, texto }),
  publicarClickup: (tareaId: string, texto: string): Promise<{ publicado: boolean; id?: string }> => inv('publicar:clickup', { tareaId, texto }),
  instalaciones: (): Promise<InstalacionesVista> => inv('instalaciones:conteo'),
  async grafo(): Promise<{ nodos: NodoVista[]; enlaces: EnlaceVista[]; notas: number }> {
    if (!enElectron) return { ...grafoDemo(), notas: 0 };
    const r = await inv<{ grafo: GrafoCrudo; notas: number }>('grafo:cargar');
    return {
      nodos: r.grafo.nodos.map((n) => ({ ...n, comunidad: n.comunidad ?? 0, nombreComunidad: n.nombreComunidad ?? `comunidad ${n.comunidad ?? 0}` })),
      enlaces: r.grafo.enlaces,
      notas: r.notas,
    };
  },
  config: (): Promise<Config> => (enElectron ? inv('config:get') : Promise.resolve({})),
  guardarConfig: (c: Config): Promise<Config> => (enElectron ? inv('config:set', c) : Promise.resolve(c)),
  perfil: (): Promise<PerfilVista> =>
    enElectron ? inv('perfil:get') : Promise.resolve({ name: 'Sistema de evaluaciones (UAM)', modelos: MODELOS_DEMO, limites: { lineasPorPr: 400 } }),
  abrir: (tipo: 'archivo' | 'carpeta'): Promise<string | undefined> => (enElectron ? inv('dialogo:abrir', tipo) : Promise.resolve(undefined)),
  notas: (): Promise<NotaVista[]> =>
    enElectron
      ? inv('notas:lista')
      : Promise.resolve([
          { ruta: 'contexto/estado-coordinacion.md', titulo: 'Estado de coordinación', carpeta: 'contexto', resumen: 'Qué está fusionado, qué espera revisión y quién debe qué en cada tarea de BFA.', palabras: 1850 },
          { ruta: 'contexto/plan-particion-41.md', titulo: 'Plan para partir el #41', carpeta: 'contexto', resumen: 'Piezas del GEN-03-BE con ids Long, en el orden en que entran.', palabras: 620 },
          { ruta: 'contexto/plan-int-05.md', titulo: 'INT-05, publicar la versión estable', carpeta: 'contexto', resumen: 'Checklist para etiquetar y desplegar el release.', palabras: 310 },
          { ruta: 'docs/DOC-05-API.md', titulo: 'Contrato API (DOC-05)', carpeta: 'docs', resumen: 'Endpoints E1 a E31, errores comunes y ejemplos.', palabras: 5200 },
          { ruta: 'docs/FLUJO.md', titulo: 'Flujo acordado', carpeta: 'docs', resumen: 'De la planificación al traspaso: quién hace qué en cada paso.', palabras: 420 },
        ]),
  nota: (ruta: string): Promise<string | undefined> =>
    enElectron
      ? inv('nota:leer', ruta)
      : Promise.resolve(`# Estado de coordinación

Corte de la semana. Lo que entró, lo que espera revisión y quién debe qué.

## Qué entró a main
- **GEN-01-BE** (catálogo y detalle): fusionado con \`ci-ok\` y \`testing-ok\`.
- **GEN-07-BE** (versionado de formularios): fusionado.
- Contrato E1 a E31 publicado en \`docs/api/openapi.yaml\`.

## Espera revisión
- **BFA-BE-01**: falta corregir título y cuerpo del PR.
- **BFA-BE-04**: espera la etiqueta \`testing-ok\`.

## Decisiones
1. El dueño del modelo \`Evaluacion\` es el PR del motor común, con ids \`Long\`.
2. Los errores se manejan con un manejador acotado por controlador.

## Pendiente
- Partir el motor común en piezas de unas 400 líneas.
- Definir quién persiste la calificación y los puntajes.
`),
  sesiones: (): Promise<{ claude: EstadoSesion; codex: EstadoSesion }> =>
    enElectron
      ? inv('sesion:estado')
      : Promise.resolve({
          claude: { cli: 'claude', instalado: true, conectado: true, detalle: 'demo · plan pro · claude.ai' },
          codex: { cli: 'codex', instalado: false, conectado: false, detalle: 'Codex no está instalado.' },
        }),
  iniciarSesion: (cli: 'claude' | 'codex'): Promise<EstadoSesion> => inv('sesion:iniciar', cli),
  revisarPr: (n: string): Promise<Informe> =>
    enElectron
      ? inv('pr:revisar', n)
      : Promise.resolve({
          ok: false,
          lineas: 521,
          errores: [
            { regla: 'titulo', mensaje: 'El título "Feature/rodrigo-ramirez-bfa-be-01" no cumple [BFA-BE-01] descripción.', arreglo: 'Ejemplo: [GEN-01-BE] Consultar catálogo y detalle de tests.' },
            { regla: 'cuerpo', mensaje: 'El cuerpo sigue con texto de la plantilla sin completar.', arreglo: 'Reemplaza <código> y <id interno> por los reales.' },
          ],
          avisos: [{ regla: 'tamano', mensaje: 'El PR cambia 521 líneas; lo acordado es ≈400.' }],
          verificaciones: ['mvn -f backend/pom.xml spotless:check'],
        }),
  revisarCola: (): Promise<RevisionVista[]> =>
    enElectron
      ? inv('revisar:cola')
      : Promise.resolve([
          { numero: 79, titulo: '[BFA-BE-01] Módulo BFA y configuración de las subpruebas', autor: 'luis-dev', url: '', ci: 'ok', lineas: 521, errores: 8, avisos: 2, hallazgos: [{ gravedad: 'ERROR', regla: 'titulo', mensaje: 'El título no cumple [BFA-BE-01] descripción.', arreglo: 'Ejemplo: [GEN-01-BE] Consultar catálogo.' }, { gravedad: 'ERROR', regla: 'cuerpo', mensaje: 'El cuerpo sigue con texto de la plantilla.' }, { gravedad: 'AVISO', regla: 'tamano', mensaje: 'El PR cambia 521 líneas; lo acordado es ≈400.' }], comentario: 'Revisión de Integración del #79...' },
          { numero: 77, titulo: '[BFA-BE-04] Calificador de selección por bloque', autor: 'marta-fe', url: '', ci: 'ok', lineas: 225, errores: 0, avisos: 0, hallazgos: [], comentario: 'Revisión de Integración del #77: el formato está completo.' },
          { numero: 80, titulo: 'Feature/pedro GEN 05 BE', autor: 'pedro-be', url: '', ci: 'fallo', lineas: 880, errores: 5, avisos: 1, hallazgos: [{ gravedad: 'ERROR', regla: 'rama', mensaje: 'La rama no cumple tipo/nombre-código.' }], comentario: 'Revisión de Integración del #80...' },
        ]),
  programadas: (): Promise<{ lista: ProgramadaVista[]; integrador: boolean }> =>
    enElectron
      ? inv('programadas:lista')
      : Promise.resolve({
          integrador: true,
          lista: [
            { id: 'avisos', activo: true, cadaMin: 5, ultima: new Date().toISOString(), resultado: 'Sin novedades' },
            { id: 'resumen-dia', activo: false, hora: '09:00' },
            { id: 'revisar-prs', activo: true, cadaMin: 15, resultado: '15 PR revisados, 6 con errores' },
            { id: 'informe-cola', activo: false, hora: '17:00' },
          ],
        }),
  guardarProgramadas: (l: ProgramadaVista[]): Promise<ProgramadaVista[]> => (enElectron ? inv('programadas:guardar', l) : Promise.resolve(l)),
  ejecutarProgramada: (id: string): Promise<string> => (enElectron ? inv('programadas:ejecutar', id) : Promise.resolve('Listo (demostración)')),
  hilos: (): Promise<HiloVista[]> =>
    enElectron
      ? inv('hilos:lista')
      : Promise.resolve([
          { id: 'gen-01-fe', rol: 'desarrollador', objetivo: 'Pantalla de catálogo y detalle de tests', tarea: 'GEN-01-FE', plan: [{ texto: 'Lista del catálogo con estados de carga y error', hecho: true }, { texto: 'Detalle con subpruebas', hecho: false }, { texto: 'Pruebas de ambas pantallas', hecho: false }], decisiones: [{ fecha: '2026-11-23', texto: 'Usar el cliente HTTP común', motivo: 'sin duplicar tipos' }], abiertas: [], prohibido: [], actualizado: '2026-11-23T12:00:00Z' },
        ]),
  guardarHilo: (h: HiloVista): Promise<HiloVista[]> => inv('hilos:guardar', h),
  contexto: (o: unknown): Promise<PaqueteVista> =>
    enElectron ? inv('contexto:paquete', o) : Promise.resolve({ texto: '## Contexto del grafo\n- (demo)', tokens: 573, tokensTodo: 9800, ahorro: 0.94, nodos: 23, recortado: false }),
  copiar: (t: string): Promise<void> => (enElectron ? inv('portapapeles:copiar', t) : navigator.clipboard.writeText(t)),
  orquestar: (p: { objetivo: string; rol: string; hiloId?: string }): void => {
    if (enElectron) void inv('agentes:orquestar', p);
  },
  alEvento: (cb: (e: EventoAgente) => void): (() => void) => (enElectron ? window.hilo!.alEvento((e) => cb(e as EventoAgente)) : () => {}),
};
