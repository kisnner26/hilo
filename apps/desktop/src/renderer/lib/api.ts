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
export type Funcion = 'orquestador' | 'desarrollo' | 'documentacion' | 'integracion' | 'testing';
export interface Config {
  perfil?: string;
  grafo?: string;
  boveda?: string;
  proyecto?: string;
  raiz?: string;
  repo?: string;
  modelos?: Partial<Record<Funcion, ModeloAsignado>>;
  permitirEditar?: boolean;
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

export interface Conexion {
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

declare global {
  interface Window {
    hilo?: { invocar: (canal: string, ...args: unknown[]) => Promise<unknown>; alEvento: (cb: (e: unknown) => void) => () => void; alCodigo: (cb: (e: unknown) => void) => () => void };
  }
}

export const enElectron = typeof window !== 'undefined' && Boolean(window.hilo);
const inv = <T>(canal: string, ...a: unknown[]) => window.hilo!.invocar(canal, ...a) as Promise<T>;

interface GrafoCrudo {
  nodos: { id: string; label: string; tipo?: string; archivo?: string; comunidad?: number; nombreComunidad?: string }[];
  enlaces: EnlaceVista[];
}

const MODELOS_DEMO: PerfilVista['modelos'] = {
  orquestador: { cli: 'claude', modelo: 'claude-opus-5-5', esfuerzo: 'medium' },
  desarrollo: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' },
  documentacion: { cli: 'claude', modelo: 'claude-haiku-5-5', esfuerzo: 'low' },
  integracion: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' },
  testing: { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: 'low' },
};

/** En el navegador (sin Electron) responde con datos de demostración para poder ver y probar la interfaz. */
const DEMO_DIA: MiDiaVista = {
  saludo: 'Jimmy',
  rol: 'desarrollador',
  tareas: [
    { id: '1', codigo: 'GEN-01-FE', nombre: 'GEN-01-FE — catálogo y detalle', estado: 'in progress', asignados: ['JIMMY'], dependeDe: [] },
    { id: '2', codigo: 'UI-02', nombre: 'UI-02 — navegación y flujo', estado: 'Open', asignados: ['JIMMY'], vence: '2026-11-18T10:00:00Z', dependeDe: [] },
    { id: '3', codigo: 'GEN-04-FE', nombre: 'GEN-04-FE — finalización', estado: 'Open', asignados: ['JIMMY'], dependeDe: ['x'] },
  ],
  prs: [{ numero: 42, titulo: '[GEN-01-FE] catálogo de tests', autor: 'aleelezz', rama: 'feature/jimmy-GEN-01-FE', borrador: true, url: 'https://github.com/Nell16/sistema-evaluaciones/pull/42', ci: 'fallo', revision: 'requerida', estadoFusion: 'BEHIND', pidenMiRevision: false, erroresDeFormato: 2 }],
  paraRevisar: [],
  acciones: [
    { prioridad: 1, tipo: 'ci', texto: 'El CI del #42 falló: corrígelo antes de pedir revisión.', ref: '#42' },
    { prioridad: 2, tipo: 'formato', texto: 'El #42 tiene 2 error(es) de formato: corrígelos de una vez.', ref: '#42' },
    { prioridad: 3, tipo: 'vencida', texto: 'UI-02 venció el 2026-11-18: entrega o avisa una fecha nueva.', ref: 'UI-02' },
    { prioridad: 5, tipo: 'entrega', texto: 'GEN-01-FE tiene el PR #42 pero sigue en "in progress": comenta la entrega.', ref: 'GEN-01-FE', preparado: 'Entrega GEN-01-FE\n\nEnlace: https://github.com/Nell16/sistema-evaluaciones/pull/42\nSHA probado: FALTA\n\nContribución de cada participante:\n- JIMMY\n\nPendiente del equipo (Integración, Testing, Documentación):\n- testing-ok y revisión de Integración' },
    { prioridad: 6, tipo: 'espera', texto: 'GEN-04-FE espera a GEN-04-BE.', ref: 'GEN-04-FE' },
  ],
};

export const api = {
  conexion: (): Promise<Conexion> =>
    enElectron ? inv('conexion:estado') : Promise.resolve({ github: { conectado: true, login: 'aleelezz', nombre: 'Jimmy Galo' }, clickup: { conectado: true, usuario: 'JIMMY ALEJANDRO GALO HERNANDEZ' }, repos: ['Nell16/sistema-evaluaciones'], repo: 'Nell16/sistema-evaluaciones', avisos: true }),
  githubToken: (t: string): Promise<{ login: string; nombre: string }> => inv('github:token', t),
  githubBorrarToken: (): Promise<void> => inv('github:borrar-token'),
  diagnostico: (): Promise<Prueba[]> =>
    enElectron
      ? inv('diagnostico:correr')
      : Promise.resolve([
          { grupo: 'Herramientas', nombre: 'GitHub CLI', estado: 'ok', detalle: '/opt/homebrew/bin/gh' },
          { grupo: 'GitHub', nombre: 'Cuenta', estado: 'ok', detalle: 'aleelezz · token de gh' },
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
      : Promise.resolve({ cola: [{ numero: 79, autor: 'Rrodrovan', rondas: 3, lineas: 521, listo: true }, { numero: 42, autor: 'aleelezz', rondas: 2, lineas: 400, listo: false }], asignaciones: [{ numero: 79, integrador: 'over2099', motivo: 'menor carga' }], metricas: { prs: 2, rondasPromedio: 2.5, conMasDeTresRondas: [], cargaPorIntegrador: { kisnner26: 5, over2099: 0 }, concentracion: 1 }, integradores: ['kisnner26', 'over2099'] }),
  plan: (o: { dias: number; capacidad: number }): Promise<PlanVista> => inv('plan:generar', o),
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
  notas: (): Promise<{ ruta: string; titulo: string; carpeta: string }[]> =>
    enElectron
      ? inv('notas:lista')
      : Promise.resolve([
          { ruta: 'contexto/estado-coordinacion.md', titulo: 'Estado de coordinación', carpeta: 'contexto' },
          { ruta: 'contexto/plan-particion-41.md', titulo: 'Plan para partir el #41', carpeta: 'contexto' },
          { ruta: 'contexto/plan-int-05.md', titulo: 'INT-05, publicar la versión estable', carpeta: 'contexto' },
        ]),
  nota: (ruta: string): Promise<string | undefined> =>
    enElectron ? inv('nota:leer', ruta) : Promise.resolve(`# Vista previa\n\nEn el navegador no hay bóveda conectada: abre la app de escritorio para leer **${ruta}**.\n\n- Las notas son Markdown\n- Los [[enlaces]] forman el grafo`),
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
  hilos: (): Promise<HiloVista[]> => (enElectron ? inv('hilos:lista') : Promise.resolve([])),
  guardarHilo: (h: HiloVista): Promise<HiloVista[]> => inv('hilos:guardar', h),
  contexto: (o: unknown): Promise<PaqueteVista> =>
    enElectron ? inv('contexto:paquete', o) : Promise.resolve({ texto: '## Contexto del grafo\n- (demo)', tokens: 573, tokensTodo: 9800, ahorro: 0.94, nodos: 23, recortado: false }),
  copiar: (t: string): Promise<void> => (enElectron ? inv('portapapeles:copiar', t) : navigator.clipboard.writeText(t)),
  orquestar: (p: { objetivo: string; rol: string; hiloId?: string }): void => {
    if (enElectron) void inv('agentes:orquestar', p);
  },
  alEvento: (cb: (e: EventoAgente) => void): (() => void) => (enElectron ? window.hilo!.alEvento((e) => cb(e as EventoAgente)) : () => {}),
};
