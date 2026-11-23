/** Ahorro de tokens opcional y personalizable: cada técnica se enciende o apaga, y hay tres preajustes. */

export interface AjustesAhorro {
  /** Interruptor general: apagado equivale al preajuste "libre". */
  activo: boolean;
  /** Mandar un resumen corto del proyecto en vez de listar el grafo. */
  resumen: boolean;
  /** Acotar el contexto a la vecindad y al rol, con un tope de tokens. */
  alcance: boolean;
  /** Recortar las notas a los párrafos que tocan la pregunta. */
  extractos: boolean;
  /** Pedir respuestas cortas a los agentes de código y pruebas. */
  estiloBreve: boolean;
  /** Comprimir logs y diffs antes de enviarlos. */
  comprimirLogs: boolean;
  /** Continuar la conversación con la sesión del agente (sin reenviar el historial). */
  sesionContinua: boolean;
  /** Responder con datos locales las preguntas simples, sin gastar tokens. */
  respuestasInmediatas: boolean;
  presupuesto: number;
  maxSubagentes: number;
  maxLineasDiff: number;
  maxCaracteresNota: number;
}

export type PresetAhorro = 'maximo' | 'equilibrado' | 'libre';

const BASE: AjustesAhorro = {
  activo: true,
  resumen: true,
  alcance: true,
  extractos: true,
  estiloBreve: true,
  comprimirLogs: true,
  sesionContinua: true,
  respuestasInmediatas: true,
  presupuesto: 1500,
  maxSubagentes: 5,
  maxLineasDiff: 300,
  maxCaracteresNota: 1000,
};

export function presetAhorro(p: PresetAhorro): AjustesAhorro {
  if (p === 'maximo') return { ...BASE, presupuesto: 800, maxSubagentes: 3, maxLineasDiff: 150, maxCaracteresNota: 600 };
  if (p === 'libre') return { ...BASE, activo: false, resumen: false, alcance: false, extractos: false, estiloBreve: false, comprimirLogs: false, presupuesto: 6000, maxSubagentes: 6, maxLineasDiff: 800, maxCaracteresNota: 3000 };
  return { ...BASE };
}

/**
 * Lo que realmente se aplica: si el interruptor general está apagado, manda el preajuste "libre"
 * (contextos amplios y respuestas completas, para modelos fuertes que no importa que gasten más).
 * Las respuestas inmediatas y la sesión continua se conservan: no cuestan tokens y mejoran la experiencia.
 */
export function ahorroEfectivo(c?: Partial<AjustesAhorro>): AjustesAhorro {
  const m = { ...BASE, ...(c ?? {}) };
  if (m.activo) return m;
  const libre = presetAhorro('libre');
  return { ...libre, respuestasInmediatas: m.respuestasInmediatas, sesionContinua: m.sesionContinua };
}

export const TECNICAS_AHORRO: { clave: keyof AjustesAhorro; nombre: string; detalle: string }[] = [
  { clave: 'resumen', nombre: 'Resumen del proyecto', detalle: 'Un mapa corto en vez de listar todo.' },
  { clave: 'alcance', nombre: 'Contexto acotado', detalle: 'Solo lo cercano a la tarea y a tu rol.' },
  { clave: 'extractos', nombre: 'Notas recortadas', detalle: 'Solo los párrafos que importan.' },
  { clave: 'estiloBreve', nombre: 'Respuestas breves', detalle: 'Sin preámbulos en código y pruebas.' },
  { clave: 'comprimirLogs', nombre: 'Logs y diffs comprimidos', detalle: 'Quita ruido antes de enviar.' },
  { clave: 'sesionContinua', nombre: 'Conversación continuada', detalle: 'No reenvía el historial. Apagado, cada pregunta empieza de cero.' },
  { clave: 'respuestasInmediatas', nombre: 'Respuestas locales', detalle: '«¿Qué tarea tengo?» se responde sin modelo.' },
];
