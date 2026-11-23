import type { Perfil } from './profile.js';

export interface DatosPr {
  codigo: string;
  idClickup: string;
  modulo: string;
  resumen: string;
  rf: string;
  casosDeUso: string;
  contrato: string;
  validaciones: { texto: string; hecha: boolean }[];
  pendientes?: string;
}

/** Cuerpo de PR con el formato de la plantilla del repositorio, ya completo. */
export function cuerpoDePr(d: DatosPr): string {
  const v = d.validaciones.map((x) => `- [${x.hecha ? 'x' : ' '}] ${x.texto}`).join('\n');
  return [
    '## Tarea y alcance',
    '',
    `- Tarea ClickUp: ${d.codigo} · CU-${d.idClickup}`,
    `- Módulo: ${d.modulo}`,
    `- Resumen del cambio: ${d.resumen}`,
    '',
    '## Trazabilidad',
    '',
    `- RF / RNF: ${d.rf}`,
    `- Caso(s) de uso: ${d.casosDeUso}`,
    `- Contrato API / migración impactada: ${d.contrato}`,
    '',
    '## Validaciones',
    '',
    v,
    ...(d.pendientes ? ['', `Pendiente: ${d.pendientes}`] : []),
    '',
  ].join('\n');
}

export type TipoComentario = 'avance' | 'entrega' | 'bloqueo' | 'pregunta' | 'integracion';

export interface DatosComentario {
  tipo: TipoComentario;
  codigo: string;
  /** Enlace al PR o al documento. */
  enlace?: string;
  sha?: string;
  /** Una línea por participante, ya redactada por quien trabajó. */
  contribuciones?: string[];
  hecho?: string[];
  pendientes?: string[];
  /** Solo en bloqueo y pregunta. */
  causa?: string;
  desbloqueaCon?: string;
  quien?: string;
  fecha?: string;
}

const lista = (x: string[] | undefined) => (x && x.length > 0 ? x.map((i) => `- ${i}`).join('\n') : '- ninguno');

/** Comentarios de ClickUp con los campos que Integración pide cada vez, en el mismo orden. */
export function comentarioClickup(d: DatosComentario): string {
  switch (d.tipo) {
    case 'avance':
      return [
        `Avance ${d.codigo}`,
        '',
        'Hecho:',
        lista(d.hecho),
        ...(d.enlace ? ['', `Enlace: ${d.enlace}`] : []),
        ...(d.sha ? [`SHA: ${d.sha}`] : []),
        '',
        'Pendiente:',
        lista(d.pendientes),
      ].join('\n');
    case 'entrega':
      return [
        `Entrega ${d.codigo}`,
        '',
        `Enlace: ${d.enlace ?? 'FALTA'}`,
        `SHA probado: ${d.sha ?? 'FALTA'}`,
        '',
        'Contribución de cada participante:',
        lista(d.contribuciones),
        '',
        'Qué incluye:',
        lista(d.hecho),
        '',
        'Pendiente del equipo (Integración, Testing, Documentación):',
        lista(d.pendientes),
      ].join('\n');
    case 'bloqueo':
      return [
        `Bloqueo ${d.codigo}`,
        '',
        `Causa: ${d.causa ?? 'FALTA'}`,
        `Se desbloquea con: ${d.desbloqueaCon ?? 'FALTA'}${d.enlace ? ` (${d.enlace})` : ''}`,
        `Depende de: ${d.quien ?? 'FALTA'}`,
      ].join('\n');
    case 'pregunta':
      return [
        `Pregunta ${d.codigo}${d.quien ? ` para ${d.quien}` : ''}`,
        '',
        `${d.causa ?? 'FALTA la pregunta'}`,
        '',
        'Opciones:',
        lista(d.hecho),
        ...(d.fecha ? ['', `Necesito la respuesta antes de: ${d.fecha}`] : []),
      ].join('\n');
    case 'integracion':
      return [
        `Integración${d.fecha ? `, ${d.fecha}` : ''}. ${d.codigo}`,
        '',
        lista(d.hecho),
        ...(d.enlace ? ['', d.enlace] : []),
        '',
        'Falta:',
        lista(d.pendientes),
      ].join('\n');
  }
}

const reSha = /\b[0-9a-f]{7,40}\b/;
const reEnlace = /https?:\/\/\S+|\bPR\s*#\d+|\b#\d{1,4}\b/i;

/**
 * Revisa un comentario ya escrito (de un compañero o de un agente) contra el formato acordado.
 * Sirve para devolver una sola lista de correcciones en vez de pedirlas una por una.
 */
export function validarComentario(texto: string, tipo: TipoComentario, p: Perfil, participantes = 1): string[] {
  const faltas: string[] = [];
  const t = texto.toLowerCase();
  if (tipo === 'entrega' || tipo === 'avance') {
    if (!reEnlace.test(texto)) faltas.push('Falta el enlace al PR o al documento.');
    if (tipo === 'entrega' && !reSha.test(texto)) faltas.push('Falta el SHA probado.');
    if (!/pendiente/.test(t)) faltas.push('Falta la sección de pendientes concretos (si no hay, escribe "ninguno").');
  }
  if (tipo === 'entrega' && participantes > 1 && !/contribuci[oó]n/.test(t)) {
    faltas.push(`Falta la contribución de cada participante (${p.evidencia.campos[1]}).`);
  }
  if (tipo === 'bloqueo' && !/(desbloquea|depende)/.test(t)) faltas.push('Falta qué desbloquea la tarea y de quién depende.');
  if (tipo === 'pregunta' && !/\?/.test(texto)) faltas.push('Una pregunta debe formularse como pregunta, con opciones si las hay.');
  if (/\bfalta\b$/im.test(texto) && /: FALTA/.test(texto)) faltas.push('Quedó un campo con "FALTA" sin completar.');
  return faltas;
}
