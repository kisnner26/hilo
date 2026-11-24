/** Puente para pedirle algo al agente desde cualquier parte de la app: abre el Asistente y envía la pregunta. */
export interface PedidoAgente {
  /** Lo que se le manda al agente (puede llevar contexto acotado). */
  texto?: string;
  /** Lo que se ve como tu mensaje, corto. */
  mostrar: string;
  /** Una acción sobre una tarea o un PR: el agente trae los datos reales él mismo. */
  tarea?: { accion: 'entender' | 'hacer' | 'revisar' | 'bloqueo'; ref: string };
}

const EVENTO = 'hilo:preguntar';

export function preguntarAlAgente(p: PedidoAgente): void {
  window.dispatchEvent(new CustomEvent<PedidoAgente>(EVENTO, { detail: p }));
}

export function alPreguntarAlAgente(cb: (p: PedidoAgente) => void): () => void {
  const f = (e: Event) => cb((e as CustomEvent<PedidoAgente>).detail);
  window.addEventListener(EVENTO, f);
  return () => window.removeEventListener(EVENTO, f);
}
