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

declare global {
  interface Window {
    hilo?: { invocar: (canal: string, ...args: unknown[]) => Promise<unknown>; alEvento: (cb: (e: unknown) => void) => () => void };
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
export const api = {
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
  contexto: (o: unknown): Promise<{ texto: string; tokens: number; nodos: number; recortado: boolean }> =>
    enElectron ? inv('contexto:paquete', o) : Promise.resolve({ texto: '## Contexto del grafo\n- (demo)', tokens: 12, nodos: 1, recortado: false }),
  copiar: (t: string): Promise<void> => (enElectron ? inv('portapapeles:copiar', t) : navigator.clipboard.writeText(t)),
  orquestar: (p: { objetivo: string; rol: string; hiloId?: string }): void => {
    if (enElectron) void inv('agentes:orquestar', p);
  },
  alEvento: (cb: (e: EventoAgente) => void): (() => void) => (enElectron ? window.hilo!.alEvento((e) => cb(e as EventoAgente)) : () => {}),
};
