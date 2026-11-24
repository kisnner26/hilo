/**
 * Análisis del grafo sin dependencias de Node: lo usan el proceso principal y la interfaz (también en el
 * navegador de demostración). Responde preguntas que de otro modo habría que pagar con tokens:
 * qué usa esto, qué lo usa, qué se rompe si lo cambio, cómo se conectan dos cosas.
 */

export interface NodoG {
  id: string;
  label: string;
  archivo?: string | undefined;
  tipo?: string | undefined;
  comunidad?: number | undefined;
  nombreComunidad?: string | undefined;
}
export interface EnlaceG {
  origen: string;
  destino: string;
  relacion: string;
}
export interface GrafoG {
  nodos: NodoG[];
  enlaces: EnlaceG[];
}

interface Indice {
  porId: Map<string, NodoG>;
  sale: Map<string, { id: string; relacion: string }[]>;
  entra: Map<string, { id: string; relacion: string }[]>;
}

const cache = new WeakMap<GrafoG, Indice>();

function indice(g: GrafoG): Indice {
  const hecho = cache.get(g);
  if (hecho) return hecho;
  const porId = new Map(g.nodos.map((n) => [n.id, n]));
  const sale = new Map<string, { id: string; relacion: string }[]>();
  const entra = new Map<string, { id: string; relacion: string }[]>();
  for (const e of g.enlaces) {
    if (!porId.has(e.origen) || !porId.has(e.destino) || e.origen === e.destino) continue;
    sale.set(e.origen, [...(sale.get(e.origen) ?? []), { id: e.destino, relacion: e.relacion }]);
    entra.set(e.destino, [...(entra.get(e.destino) ?? []), { id: e.origen, relacion: e.relacion }]);
  }
  const i = { porId, sale, entra };
  cache.set(g, i);
  return i;
}

const RUIDO = /\.(ya?ml|json|xml|lock|svg)$/i;
/** Sin archivo propio es una librería externa (java.util, org.junit…): mucho grado y nada que aportar. */
export const esRuido = (n: NodoG): boolean => !n.archivo || RUIDO.test(n.archivo) || n.tipo === 'yaml' || n.tipo === 'json';

export interface Conexion {
  nodo: NodoG;
  relacion: string;
}

const grado = (i: Indice, id: string) => (i.sale.get(id)?.length ?? 0) + (i.entra.get(id)?.length ?? 0);

/** Lo que este nodo usa (sale) y lo que lo usa a él (entra), lo más conectado primero. */
export function conexiones(g: GrafoG, id: string, incluirRuido = false): { sale: Conexion[]; entra: Conexion[] } {
  const i = indice(g);
  const armar = (xs: { id: string; relacion: string }[] | undefined): Conexion[] => {
    const vistos = new Set<string>();
    const salida: Conexion[] = [];
    for (const x of xs ?? []) {
      const nodo = i.porId.get(x.id);
      if (!nodo || vistos.has(x.id) || (!incluirRuido && esRuido(nodo))) continue;
      vistos.add(x.id);
      salida.push({ nodo, relacion: x.relacion });
    }
    return salida.sort((a, b) => grado(i, b.nodo.id) - grado(i, a.nodo.id) || a.nodo.label.localeCompare(b.nodo.label));
  };
  return { sale: armar(i.sale.get(id)), entra: armar(i.entra.get(id)) };
}

export interface Alcanzado {
  nodo: NodoG;
  distancia: number;
}

function recorrer(g: GrafoG, id: string, mapa: 'sale' | 'entra', maxSaltos: number): Alcanzado[] {
  const i = indice(g);
  const visto = new Map<string, number>([[id, 0]]);
  let frontera = [id];
  for (let d = 1; d <= maxSaltos && frontera.length > 0; d++) {
    const siguiente: string[] = [];
    for (const n of frontera) {
      for (const x of i[mapa].get(n) ?? []) {
        if (visto.has(x.id)) continue;
        visto.set(x.id, d);
        siguiente.push(x.id);
      }
    }
    frontera = siguiente;
  }
  return [...visto.entries()]
    .filter(([n]) => n !== id)
    .map(([n, distancia]) => ({ nodo: i.porId.get(n)!, distancia }))
    .filter((x) => !esRuido(x.nodo))
    .sort((a, b) => a.distancia - b.distancia || grado(i, b.nodo.id) - grado(i, a.nodo.id));
}

/** Todo lo que depende de este nodo, directa o indirectamente: lo que podría romperse si lo cambias. */
export const impacto = (g: GrafoG, id: string, maxSaltos = 3): Alcanzado[] => recorrer(g, id, 'entra', maxSaltos);

/** Todo de lo que este nodo depende, directa o indirectamente: lo que hay que entender para tocarlo. */
export const dependencias = (g: GrafoG, id: string, maxSaltos = 3): Alcanzado[] => recorrer(g, id, 'sale', maxSaltos);

export interface PasoRuta {
  nodo: NodoG;
  /** Cómo se llegó a este nodo desde el anterior; vacío en el primero. */
  relacion: string;
}

/** El camino más corto entre dos nodos, sin importar el sentido de las flechas. */
export function rutaMasCorta(g: GrafoG, desde: string, hasta: string): PasoRuta[] | undefined {
  const i = indice(g);
  if (!i.porId.has(desde) || !i.porId.has(hasta)) return undefined;
  const previo = new Map<string, { de: string; relacion: string } | null>([[desde, null]]);
  let frontera = [desde];
  while (frontera.length > 0 && !previo.has(hasta)) {
    const siguiente: string[] = [];
    for (const n of frontera) {
      for (const x of [...(i.sale.get(n) ?? []), ...(i.entra.get(n) ?? [])]) {
        if (previo.has(x.id)) continue;
        previo.set(x.id, { de: n, relacion: x.relacion });
        siguiente.push(x.id);
      }
    }
    frontera = siguiente;
  }
  if (!previo.has(hasta)) return undefined;
  const camino: PasoRuta[] = [];
  for (let n: string | undefined = hasta; n !== undefined; ) {
    const p: { de: string; relacion: string } | null = previo.get(n) ?? null;
    camino.unshift({ nodo: i.porId.get(n)!, relacion: p?.relacion ?? '' });
    n = p?.de;
  }
  return camino;
}

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Búsqueda por nombre o ruta: lo que empieza igual y lo más conectado salen primero. */
export function buscar(g: GrafoG, texto: string, k = 8): NodoG[] {
  const q = sinTildes(texto.trim());
  if (q.length < 2) return [];
  const i = indice(g);
  return g.nodos
    .filter((n) => !esRuido(n))
    .map((n) => {
      const l = sinTildes(n.label);
      const a = sinTildes(n.archivo ?? '');
      const puntos = l === q ? 100 : l.startsWith(q) ? 60 : l.includes(q) ? 40 : a.includes(q) ? 15 : 0;
      return { n, puntos: puntos + Math.min(20, grado(i, n.id)) * (puntos > 0 ? 0.5 : 0) };
    })
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.n.label.localeCompare(b.n.label))
    .slice(0, k)
    .map((x) => x.n);
}

export interface Clave {
  nodo: NodoG;
  conexiones: number;
}

/** Los nodos de los que más cosas dependen: por dónde conviene empezar a leer un proyecto. */
export function puntosClave(g: GrafoG, k = 8): Clave[] {
  const i = indice(g);
  return g.nodos
    .filter((n) => !esRuido(n))
    .map((nodo) => ({ nodo, conexiones: i.entra.get(nodo.id)?.length ?? 0 }))
    .filter((x) => x.conexiones > 0)
    .sort((a, b) => b.conexiones - a.conexiones || a.nodo.label.localeCompare(b.nodo.label))
    .slice(0, k);
}

/** Resumen en una frase de qué es un nodo y cuánto pesa en el proyecto, sin usar un modelo. */
export function describir(g: GrafoG, id: string): string {
  const i = indice(g);
  const n = i.porId.get(id);
  if (!n) return '';
  const c = conexiones(g, id);
  const afectados = impacto(g, id, 3);
  const archivos = new Set(afectados.map((x) => x.nodo.archivo).filter(Boolean));
  const partes = [`${n.label} está en «${n.nombreComunidad ?? 'sin carpeta'}»${n.archivo ? ` (${n.archivo})` : ''}.`];
  partes.push(c.sale.length ? `Usa ${c.sale.length} cosa${c.sale.length === 1 ? '' : 's'}.` : 'No usa nada del proyecto.');
  partes.push(c.entra.length ? `Lo usan ${c.entra.length}.` : 'Nada lo usa directamente.');
  if (afectados.length > 0) partes.push(`Un cambio aquí puede alcanzar ${afectados.length} nodo${afectados.length === 1 ? '' : 's'} en ${archivos.size} archivo${archivos.size === 1 ? '' : 's'}.`);
  return partes.join(' ');
}
