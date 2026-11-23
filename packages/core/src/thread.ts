import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RolId } from './profile.js';
import { estimarTokens } from './context.js';

export interface Paso {
  texto: string;
  hecho: boolean;
}
export interface DecisionHilo {
  fecha: string;
  texto: string;
  motivo: string;
}

/**
 * El hilo es el estado mínimo que una sesión larga no puede perder:
 * qué se hace, con qué rol, qué ya se decidió y qué falta. Se reinyecta completo en cada turno.
 */
export interface Hilo {
  id: string;
  rol: RolId;
  objetivo: string;
  tarea?: string;
  plan: Paso[];
  decisiones: DecisionHilo[];
  abiertas: string[];
  prohibido: string[];
  actualizado: string;
}

export function nuevoHilo(id: string, rol: RolId, objetivo: string, tarea?: string, ahora = new Date()): Hilo {
  return {
    id,
    rol,
    objetivo,
    ...(tarea ? { tarea } : {}),
    plan: [],
    decisiones: [],
    abiertas: [],
    prohibido: [],
    actualizado: ahora.toISOString(),
  };
}

export const rutaHilo = (raiz: string, id: string) => join(raiz, '.hilo', 'hilos', `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

export function guardarHilo(raiz: string, h: Hilo): void {
  const ruta = rutaHilo(raiz, h.id);
  mkdirSync(join(raiz, '.hilo', 'hilos'), { recursive: true });
  writeFileSync(ruta, `${JSON.stringify(h, null, 2)}\n`);
}

export function cargarHilo(raiz: string, id: string): Hilo | undefined {
  const ruta = rutaHilo(raiz, id);
  return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as Hilo) : undefined;
}

export function listarHilos(raiz: string): Hilo[] {
  const dir = join(raiz, '.hilo', 'hilos');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Hilo)
    .sort((a, b) => b.actualizado.localeCompare(a.actualizado));
}

export function conPaso(h: Hilo, texto: string): Hilo {
  return { ...h, plan: [...h.plan, { texto, hecho: false }] };
}
export function marcarPaso(h: Hilo, indice: number, ahora = new Date()): Hilo {
  const plan = h.plan.map((p, i) => (i === indice ? { ...p, hecho: true } : p));
  return { ...h, plan, actualizado: ahora.toISOString() };
}
export function conDecision(h: Hilo, texto: string, motivo: string, ahora = new Date()): Hilo {
  return { ...h, decisiones: [...h.decisiones, { fecha: ahora.toISOString().slice(0, 10), texto, motivo }], actualizado: ahora.toISOString() };
}

/**
 * Bloque corto para inyectar en cada turno. Si no cabe en el tope, se recortan primero
 * las decisiones más viejas y los pasos ya hechos; el objetivo y lo que falta nunca se recortan.
 */
export function recordatorio(h: Hilo, maxTokens = 400): string {
  let hechos = h.plan.filter((p) => p.hecho).map((p) => p.texto);
  let decisiones = [...h.decisiones];
  const armar = () =>
    [
      `# Hilo ${h.id} — rol ${h.rol}${h.tarea ? ` — tarea ${h.tarea}` : ''}`,
      `Objetivo: ${h.objetivo}`,
      `Falta: ${h.plan.filter((p) => !p.hecho).map((p, i) => `${i + 1}) ${p.texto}`).join(' ') || 'nada pendiente'}`,
      hechos.length ? `Hecho: ${hechos.join('; ')}` : '',
      decisiones.length ? `Decidido: ${decisiones.map((d) => `${d.texto} (${d.motivo})`).join('; ')}` : '',
      h.abiertas.length ? `Preguntas abiertas: ${h.abiertas.join('; ')}` : '',
      h.prohibido.length ? `No hacer: ${h.prohibido.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  let texto = armar();
  while (estimarTokens(texto) > maxTokens && (hechos.length > 1 || decisiones.length > 1)) {
    if (hechos.length > 1) hechos = hechos.slice(1);
    else decisiones = decisiones.slice(1);
    texto = armar();
  }
  return texto;
}
