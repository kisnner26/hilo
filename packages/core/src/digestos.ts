import { comprimirSalida } from './ahorro.js';

/**
 * Digestos: lo que sale de GitHub y de las terminales es enorme y casi todo ruido. Aquí se reduce a lo que
 * un agente necesita para actuar, antes de gastar un solo token en leerlo.
 */

const MARCA_HORA = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\s?/;
const ADORNO_ACTIONS = /^##\[(group|endgroup|debug|command)\]/;
const FALLO = /(\[ERROR\]|\bERROR\b|Tests run:.*(Failures: [1-9]|Errors: [1-9])|\bFAIL(ED)?\b|error TS\d+|✖|✘|AssertionError|Exception|BUILD FAILURE|Process completed with exit code|Cannot find|is not defined|expected .* to|spotless|violations? )/i;

/** Quita marcas de hora y adornos de GitHub Actions, y deja las líneas que explican el fallo con un poco de contexto. */
export function digestoDeRegistro(registro: string, maxLineas = 40): string {
  const limpias = registro
    .split('\n')
    .map((l) => l.replace(MARCA_HORA, '').trimEnd())
    .filter((l) => l.trim() !== '' && !ADORNO_ACTIONS.test(l));
  const indices = new Set<number>();
  limpias.forEach((l, i) => {
    if (FALLO.test(l)) for (let k = Math.max(0, i - 1); k <= Math.min(limpias.length - 1, i + 1); k++) indices.add(k);
  });
  const elegidas = indices.size > 0 ? [...indices].sort((a, b) => a - b).map((i) => limpias[i]!) : limpias.slice(-15);
  return comprimirSalida(elegidas.map((l) => l.replace(/^##\[error\]/, '')).join('\n'), maxLineas);
}

export interface ComentarioRevision {
  autor: string;
  archivo?: string;
  linea?: number;
  texto: string;
  fragmento?: string;
}

/** Los comentarios de una revisión en el menor espacio posible: dónde, quién y qué piden, sin repetir. */
export function compactarComentarios(cs: ComentarioRevision[], maxCaracteresPorComentario = 420, maxComentarios = 25): string {
  const vistos = new Set<string>();
  const lineas: string[] = [];
  for (const c of cs) {
    const texto = c.texto.replace(/\s+/g, ' ').trim().slice(0, maxCaracteresPorComentario);
    const clave = `${c.archivo ?? ''}:${c.linea ?? ''}:${texto.slice(0, 60)}`;
    if (!texto || vistos.has(clave)) continue;
    vistos.add(clave);
    const donde = c.archivo ? `${c.archivo}${c.linea ? `:${c.linea}` : ''}` : 'general';
    lineas.push(`- ${donde} (${c.autor}): ${texto}`);
    if (lineas.length >= maxComentarios) break;
  }
  return lineas.join('\n');
}
