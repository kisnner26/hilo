import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import type { RolId } from './profile.js';

export interface Nodo {
  id: string;
  label: string;
  tipo?: string;
  archivo?: string;
  comunidad?: number;
  nombreComunidad?: string;
}
export interface Enlace {
  origen: string;
  destino: string;
  relacion: string;
}
export interface Grafo {
  nodos: Nodo[];
  enlaces: Enlace[];
}

/** Lee el graph.json de graphify (node_link_data). */
export function cargarGrafo(ruta: string): Grafo {
  const d = JSON.parse(readFileSync(ruta, 'utf8')) as {
    nodes: Record<string, unknown>[];
    links: Record<string, unknown>[];
  };
  return {
    nodos: d.nodes.map((n) => ({
      id: String(n.id),
      label: String(n.label ?? n.id),
      tipo: n.file_type as string | undefined,
      archivo: n.source_file as string | undefined,
      comunidad: n.community as number | undefined,
      nombreComunidad: n.community_name as string | undefined,
    })),
    enlaces: d.links.map((l) => ({
      origen: String(l.source),
      destino: String(l.target),
      relacion: String(l.relation ?? 'relacionado'),
    })),
  };
}

/**
 * Nombre legible de cada comunidad: la carpeta (últimos dos tramos) donde más archivos suyos viven.
 * Los nombres que trae graphify suelen ser frases largas; sin archivos se conserva el nombre original.
 */
export function nombrarComunidades(g: Grafo): Grafo {
  const porCom = new Map<number, Nodo[]>();
  for (const n of g.nodos) porCom.set(n.comunidad ?? 0, [...(porCom.get(n.comunidad ?? 0) ?? []), n]);
  const nombres = new Map<number, string>();
  const usados = new Map<string, number>();
  for (const [c, nodos] of [...porCom.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const cuenta = new Map<string, number>();
    for (const n of nodos) {
      const partes = (n.archivo ?? '').split('/').slice(0, -1).filter((x) => x && x !== 'repo' && x !== 'src');
      if (partes.length === 0) continue;
      const clave = partes.slice(-2).join('/');
      cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
    }
    const mejor = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    let nombre = mejor ?? nodos[0]?.nombreComunidad ?? `comunidad ${c}`;
    const veces = (usados.get(nombre) ?? 0) + 1;
    usados.set(nombre, veces);
    if (veces > 1) nombre = `${nombre} ${veces}`;
    nombres.set(c, nombre);
  }
  return { ...g, nodos: g.nodos.map((n) => ({ ...n, nombreComunidad: nombres.get(n.comunidad ?? 0) ?? n.nombreComunidad })) };
}

// ---------- Bóveda de Markdown ----------

export interface Nota {
  ruta: string;
  titulo: string;
  texto: string;
  enlaces: string[];
  carpeta: string;
}

export function cargarBoveda(raiz: string, maxBytes = 200_000): Nota[] {
  const notas: Nota[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      if (nombre.startsWith('.') || nombre === 'node_modules') continue;
      const ruta = join(dir, nombre);
      const st = statSync(ruta);
      if (st.isDirectory()) recorrer(ruta);
      else if (extname(nombre) === '.md' && st.size <= maxBytes) {
        const texto = readFileSync(ruta, 'utf8');
        const rel = relative(raiz, ruta);
        notas.push({
          ruta: rel,
          titulo: /^#\s+(.+)$/m.exec(texto)?.[1]?.trim() ?? basename(nombre, '.md'),
          texto,
          enlaces: [...texto.matchAll(/\[\[([^\]|#]+)/g)].map((m) => (m[1] ?? '').trim()),
          carpeta: rel.includes('/') ? (rel.split('/')[0] ?? '') : '(raíz)',
        });
      }
    }
  };
  recorrer(raiz);
  return notas;
}

/** Las notas también son un grafo: cada [[enlace]] une dos notas, cada carpeta es una comunidad. */
export function grafoDeBoveda(notas: Nota[]): Grafo {
  const porNombre = new Map(notas.map((n) => [basename(n.ruta, '.md').toLowerCase(), n]));
  const carpetas = [...new Set(notas.map((n) => n.carpeta))];
  const enlaces: Enlace[] = [];
  for (const n of notas) {
    for (const e of n.enlaces) {
      const dest = porNombre.get(e.toLowerCase());
      if (dest) enlaces.push({ origen: n.ruta, destino: dest.ruta, relacion: 'enlaza' });
    }
  }
  return {
    nodos: notas.map((n) => ({
      id: n.ruta,
      label: n.titulo,
      tipo: 'nota',
      archivo: n.ruta,
      comunidad: carpetas.indexOf(n.carpeta),
      nombreComunidad: n.carpeta,
    })),
    enlaces,
  };
}

export function unirGrafos(a: Grafo, b: Grafo): Grafo {
  const maxCom = Math.max(-1, ...a.nodos.map((n) => n.comunidad ?? -1));
  return {
    nodos: [...a.nodos, ...b.nodos.map((n) => ({ ...n, comunidad: (n.comunidad ?? 0) + maxCom + 1 }))],
    enlaces: [...a.enlaces, ...b.enlaces],
  };
}

// ---------- Búsqueda (BM25 sencilla, sin dependencias) ----------

const palabras = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

export function buscarNotas(notas: Nota[], consulta: string, k = 5): { nota: Nota; puntaje: number }[] {
  const q = palabras(consulta);
  const docs = notas.map((n) => palabras(`${n.titulo} ${n.titulo} ${n.texto}`));
  const N = docs.length;
  const promedio = docs.reduce((s, d) => s + d.length, 0) / Math.max(N, 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  return notas
    .map((nota, i) => {
      const d = docs[i] ?? [];
      let puntaje = 0;
      for (const w of q) {
        const f = d.filter((x) => x === w).length;
        if (f === 0) continue;
        const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        puntaje += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / promedio));
      }
      return { nota, puntaje };
    })
    .filter((x) => x.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, k);
}

// ---------- Paquetes de contexto ----------

export type Alcance =
  | { tipo: 'todo' }
  | { tipo: 'comunidad'; id: number }
  | { tipo: 'vecindad'; nodo: string; saltos: number }
  /** Varios nodos fijados a mano: la unión de sus vecindades, para armar un paquete a la medida. */
  | { tipo: 'nodos'; ids: string[]; saltos: number };

export interface OpcionesContexto {
  alcance: Alcance;
  rol?: RolId;
  conciso: boolean;
  sinRuido: boolean;
  /** Palabras de la tarea: lo que coincide sube en el orden. */
  consulta?: string;
  /** Tope de tokens estimados; se recorta lo menos conectado primero. */
  presupuesto: number;
}

export const estimarTokens = (t: string) => Math.ceil(t.length / 4);

const RUIDO = /\.(ya?ml|json|xml|lock|svg)$/i;
const LENTE: Record<RolId, RegExp | undefined> = {
  desarrollador: /(\/src\/|\.java$|\.tsx?$|\.sql$)/i,
  documentador: /(docs\/|\.md$)/i,
  tester: /(test|tests\/|postman|\.spec\.|\.test\.)/i,
  integrador: undefined,
};

function grados(g: Grafo): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of g.enlaces) {
    m.set(e.origen, (m.get(e.origen) ?? 0) + 1);
    m.set(e.destino, (m.get(e.destino) ?? 0) + 1);
  }
  return m;
}

function vecindad(g: Grafo, raiz: string, saltos: number): Set<string> {
  const ady = new Map<string, string[]>();
  for (const e of g.enlaces) {
    ady.set(e.origen, [...(ady.get(e.origen) ?? []), e.destino]);
    ady.set(e.destino, [...(ady.get(e.destino) ?? []), e.origen]);
  }
  let frontera = [raiz];
  const visto = new Set(frontera);
  for (let i = 0; i < saltos; i++) {
    frontera = frontera.flatMap((n) => ady.get(n) ?? []).filter((n) => !visto.has(n));
    for (const n of frontera) visto.add(n);
  }
  return visto;
}

export interface Paquete {
  texto: string;
  tokens: number;
  nodos: number;
  recortado: boolean;
}

/** Markdown listo para pegar en una sesión: lo fijo primero y lo variable al final, para que el caché lo reutilice. */
export function paqueteDeContexto(g: Grafo, o: OpcionesContexto, prefijoFijo = ''): Paquete {
  const grado = grados(g);
  const lente = o.rol ? LENTE[o.rol] : undefined;
  let candidatos = g.nodos;
  if (o.alcance.tipo === 'comunidad') candidatos = candidatos.filter((n) => n.comunidad === (o.alcance as { id: number }).id);
  if (o.alcance.tipo === 'vecindad') {
    const v = vecindad(g, o.alcance.nodo, o.alcance.saltos);
    candidatos = candidatos.filter((n) => v.has(n.id));
  }
  if (o.alcance.tipo === 'nodos') {
    const a = o.alcance;
    const union = new Set(a.ids.flatMap((id) => [...vecindad(g, id, a.saltos)]));
    candidatos = candidatos.filter((n) => union.has(n.id));
  }
  if (o.sinRuido) {
    // Sin archivo propio = librería externa importada (org.junit..., java.util...): mucho grado, nada que aportar.
    candidatos = candidatos.filter((n) => Boolean(n.archivo) && !RUIDO.test(n.archivo ?? '') && n.tipo !== 'yaml' && n.tipo !== 'json');
  }
  if (lente) {
    const enLente = candidatos.filter((n) => (n.archivo ? lente.test(n.archivo) : true));
    if (enLente.length > 0) candidatos = enLente;
  }
  const claves = o.consulta ? palabras(o.consulta) : [];
  const relevancia = (n: Nodo) => {
    const t = palabras(`${n.label} ${n.archivo ?? ''}`);
    return claves.reduce((s, c) => s + (t.some((w) => w.includes(c) || c.includes(w)) ? 25 : 0), 0);
  };
  candidatos = [...candidatos].sort((a, b) => relevancia(b) + (grado.get(b.id) ?? 0) - (relevancia(a) + (grado.get(a.id) ?? 0)));

  const linea = (n: Nodo) =>
    o.conciso
      ? `- ${n.label}${n.archivo ? ` (${n.archivo})` : ''}`
      : `- ${n.label} · ${n.tipo ?? '?'} · ${n.archivo ?? 'sin archivo'} · comunidad ${n.nombreComunidad ?? n.comunidad ?? '?'} · ${grado.get(n.id) ?? 0} enlaces`;

  const cabecera = [prefijoFijo, '## Contexto del grafo', ''].filter(Boolean).join('\n');
  let usado = estimarTokens(cabecera);
  const lineas: string[] = [];
  let recortado = false;
  for (const n of candidatos) {
    const l = linea(n);
    const costo = estimarTokens(l) + 1;
    if (usado + costo > o.presupuesto) {
      recortado = true;
      break;
    }
    lineas.push(l);
    usado += costo;
  }
  const ids = new Set(candidatos.slice(0, lineas.length).map((n) => n.id));
  const rel = g.enlaces
    .filter((e) => ids.has(e.origen) && ids.has(e.destino))
    .slice(0, o.conciso ? 0 : 40)
    .map((e) => `- ${e.origen.split('_').slice(-2).join('_')} —${e.relacion}→ ${e.destino.split('_').slice(-2).join('_')}`);
  const texto = [cabecera, ...lineas, ...(rel.length ? ['', '### Relaciones', ...rel] : []), ''].join('\n');
  return { texto, tokens: estimarTokens(texto), nodos: lineas.length, recortado };
}
