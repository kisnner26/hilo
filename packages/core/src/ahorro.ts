import { estimarTokens, type Grafo, type Nodo, type Paquete } from './context.js';
import { recordatorio, type Hilo } from './thread.js';

/** Técnicas para gastar menos contexto: resumen estático, sesión nueva, logs comprimidos, fragmentos relevantes y medición. */

const RUIDO = /\.(ya?ml|json|xml|lock|svg)$/i;

function grados(g: Grafo): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of g.enlaces) {
    m.set(e.origen, (m.get(e.origen) ?? 0) + 1);
    m.set(e.destino, (m.get(e.destino) ?? 0) + 1);
  }
  return m;
}

/**
 * Resumen estático: los nodos más conectados de cada comunidad, una línea por comunidad.
 * Es el "mapa" que evita que la IA vuelva a escanear el proyecto entero.
 */
export function resumenEstatico(g: Grafo, opciones: { porComunidad?: number; maxComunidades?: number } = {}): string {
  const { porComunidad = 3, maxComunidades = 14 } = opciones;
  const grado = grados(g);
  const grupos = new Map<number, Nodo[]>();
  for (const n of g.nodos) {
    if (!n.archivo || RUIDO.test(n.archivo)) continue;
    grupos.set(n.comunidad ?? 0, [...(grupos.get(n.comunidad ?? 0) ?? []), n]);
  }
  const lineas = [...grupos.values()]
    .sort((a, b) => b.length - a.length)
    .slice(0, maxComunidades)
    .map((ns) => {
      const top = [...ns].sort((a, b) => (grado.get(b.id) ?? 0) - (grado.get(a.id) ?? 0)).slice(0, porComunidad);
      return `- ${ns[0]?.nombreComunidad ?? 'sin nombre'} (${ns.length}): ${top.map((n) => n.label).join(', ')}`;
    });
  return [`## Resumen del proyecto (${g.nodos.length} nodos, ${g.enlaces.length} enlaces)`, ...lineas, ''].join('\n');
}

/** Prompt de traspaso para abrir una sesión limpia sin perder el hilo: reglas fijas primero, lo variable al final. */
export function sesionNueva(hilo: Hilo | undefined, resumen: string, reglas: string): string {
  return [
    reglas,
    '',
    resumen,
    hilo ? recordatorio(hilo) : '(sin hilo guardado: pregunta cuál es el objetivo antes de actuar)',
    '',
    'Retoma desde "Falta". No releas el proyecto: pide solo el archivo o nodo que necesites.',
  ].join('\n');
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;
const AVANCE = /^\s*([⠀-⣿\-\\|/]|\d{1,3}%|\[#*=*\s*\]|Downloading|Resolving|Fetching|npm warn deprecated|npm notice|added \d+ packages|Progress:|\.\.\.)/i;
const IMPORTANTE = /(error|fail|fatal|exception|warn|✗|✖|denied|not found|cannot|timeout|BUILD (SUCCESS|FAILURE)|Tests run:|passed|failed|exit code)/i;

/**
 * Reduce la salida de una terminal antes de que entre al contexto: quita color y barras de avance,
 * junta líneas repetidas y se queda con errores, resúmenes y el inicio y el final.
 */
export function comprimirSalida(texto: string, maxLineas = 60): string {
  const limpias = texto.replace(ANSI, '').replace(/\r/g, '\n').split('\n').map((l) => l.trimEnd());
  const sinAvance = limpias.filter((l) => l.trim() !== '' && !AVANCE.test(l));
  const juntas: string[] = [];
  for (const l of sinAvance) {
    const ultima = juntas[juntas.length - 1];
    const base = ultima?.replace(/ \(x\d+\)$/, '');
    if (base === l) juntas[juntas.length - 1] = `${l} (x${Number(/ \(x(\d+)\)$/.exec(ultima ?? '')?.[1] ?? 1) + 1})`;
    else juntas.push(l);
  }
  if (juntas.length <= maxLineas) return juntas.join('\n');
  const cabeza = juntas.slice(0, 8);
  const cola = juntas.slice(-12);
  const medio = juntas.slice(8, -12).filter((l) => IMPORTANTE.test(l)).slice(0, maxLineas - 20);
  return [...cabeza, `[... ${juntas.length - cabeza.length - cola.length - medio.length} líneas omitidas ...]`, ...medio, ...cola].join('\n');
}

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** De una nota larga, solo los párrafos que tocan la consulta (y los títulos), en su orden original. */
export function extractoRelevante(texto: string, consulta: string, maxCaracteres = 1200): string {
  const claves = sinTildes(consulta).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const parrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const puntuados = parrafos.map((p, i) => ({ p, i, s: claves.reduce((n, c) => n + (sinTildes(p).includes(c) ? 1 : 0), 0) + (/^#/.test(p) ? 0.5 : 0) }));
  const elegidos: typeof puntuados = [];
  let usado = 0;
  for (const x of [...puntuados].sort((a, b) => b.s - a.s || a.i - b.i)) {
    if (x.s === 0 && elegidos.length > 0) break;
    if (usado + x.p.length > maxCaracteres && elegidos.length > 0) continue;
    elegidos.push(x);
    usado += x.p.length;
  }
  return elegidos.sort((a, b) => a.i - b.i).map((x) => (x.p.length > maxCaracteres ? `${x.p.slice(0, maxCaracteres)}…` : x.p)).join('\n\n');
}

export interface Ahorro {
  tokens: number;
  tokensTodo: number;
  /** Fracción ahorrada frente a mandar todo el grafo, de 0 a 1. */
  ahorro: number;
}

/** Cuánto pesa mandar todo el grafo (una línea por nodo) frente al paquete acotado. Estimación: caracteres entre 4. */
export function medirAhorro(g: Grafo, paquete: Pick<Paquete, 'tokens'>): Ahorro {
  const todo = g.nodos.map((n) => `- ${n.label}${n.archivo ? ` (${n.archivo})` : ''}`).join('\n');
  const tokensTodo = estimarTokens(todo);
  return { tokens: paquete.tokens, tokensTodo, ahorro: tokensTodo === 0 ? 0 : Math.max(0, 1 - paquete.tokens / tokensTodo) };
}
