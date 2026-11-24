import { createHash } from 'node:crypto';
import type { AjustesAhorro } from './ahorro-config.js';
import { merecePedirAvance, type Bloqueo } from './bloqueos.js';
import type { DetalleTarea } from './chat.js';
import { extractoRelevante } from './ahorro.js';
import type { MiDia, PrResumen } from './midia.js';
import { codigoDeTitulo, type ModeloAsignado, type Perfil } from './profile.js';

/**
 * Autopiloto: convierte "Mi día" y "quién te bloquea" en una lista de pasos. Cada paso lo resuelve Hilo solo
 * (sin tokens), un agente ligero (redacta) o un agente completo (edita y prueba en un espacio aislado).
 * Nada sale al mundo sin que la persona lo apruebe: el autopiloto prepara, no publica.
 */

export type TipoPaso = 'actualizar-rama' | 'arreglar-ci' | 'aplicar-revision' | 'corregir-formato' | 'iniciar-tarea' | 'entregar' | 'explicar-bloqueo' | 'avisar' | 'revisar-pr';
export type Salida = 'ninguna' | 'comentario-github' | 'comentario-clickup' | 'rama-y-pr' | 'push' | 'editar-pr';

export interface PasoAuto {
  id: string;
  tipo: TipoPaso;
  /** Código de tarea o #PR sobre el que actúa. */
  ref: string;
  tarea?: string;
  pr?: number;
  titulo: string;
  ejecutor: 'hilo' | 'agente';
  salida: Salida;
  /** Edita archivos en un espacio aislado. */
  escritura: boolean;
  peso: 'ligero' | 'completo';
  prioridad: number;
  /** Texto ya redactado por Hilo (pasos sin agente). */
  texto?: string;
  /** Destino del comentario: número de PR o id de tarea de ClickUp. */
  destino?: string;
}

export interface OpcionesPlan {
  maxPasos?: number;
  /** Cuántas tareas nuevas arrancar por corrida: cada una es un paso pesado. */
  maxIniciar?: number;
  /** Mínimo de días de espera para sugerir un recordatorio. */
  diasParaAvisar?: number;
}

const codigoDePr = (p: PrResumen): string | undefined => codigoDeTitulo(p.titulo);

export function planAutopiloto(dia: MiDia, bloqueos: Bloqueo[], perfil: Perfil, opciones: OpcionesPlan = {}): PasoAuto[] {
  const { maxPasos = 12, maxIniciar = 1, diasParaAvisar = 2 } = opciones;
  const pasos = new Map<string, PasoAuto>();
  const poner = (p: PasoAuto) => {
    if (!pasos.has(p.id)) pasos.set(p.id, p);
  };
  const prPorRef = (ref: string) => (/^#\d+$/.test(ref) ? [...dia.prs, ...dia.paraRevisar].find((p) => p.numero === Number(ref.slice(1))) : undefined);
  const idTarea = (codigo: string) => dia.tareas.find((t) => t.codigo === codigo)?.id;

  for (const b of bloqueos) {
    if (b.automatico === 'actualizar-rama' && b.pr) {
      poner({ id: `actualizar-rama:#${b.pr}`, tipo: 'actualizar-rama', ref: `#${b.pr}`, tarea: b.tarea, pr: b.pr, titulo: `Actualizar la rama del #${b.pr}`, ejecutor: 'hilo', salida: 'ninguna', escritura: false, peso: 'ligero', prioridad: 1 });
    }
    if (b.tipo === 'dependencia' && !b.tuTurno) {
      const tarea = dia.tareas.find((t) => t.codigo === b.tarea);
      if (tarea && /block/i.test(tarea.estado) && idTarea(b.tarea)) {
        poner({ id: `explicar-bloqueo:${b.tarea}`, tipo: 'explicar-bloqueo', ref: b.tarea, tarea: b.tarea, titulo: `Explicar el bloqueo de ${b.tarea}`, ejecutor: 'hilo', salida: 'comentario-clickup', escritura: false, peso: 'ligero', prioridad: 3, destino: idTarea(b.tarea)!, texto: `Bloqueo ${b.tarea}\n\nCausa: ${b.causa}\nSe desbloquea con: que ${b.quien.join(', ') || 'su responsable'} cierre lo pendiente o confirme una fecha.\nDepende de: ${b.quien.join(', ') || 'FALTA'}` });
      }
    }
    if (merecePedirAvance(b, diasParaAvisar) && b.recordatorio) {
      const destino = b.canal === 'github' ? String(b.pr ?? '') : (idTarea(b.tarea) ?? '');
      if (destino) poner({ id: `avisar:${b.tipo}:${b.pr ?? b.tarea}`, tipo: 'avisar', ref: b.pr ? `#${b.pr}` : b.tarea, tarea: b.tarea, ...(b.pr ? { pr: b.pr } : {}), titulo: `Avisar a ${b.quien.join(', ')}: ${b.causa}`, ejecutor: 'hilo', salida: b.canal === 'github' ? 'comentario-github' : 'comentario-clickup', escritura: false, peso: 'ligero', prioridad: 7, texto: b.recordatorio, destino });
    }
  }

  let iniciar = 0;
  for (const a of dia.acciones) {
    const pr = prPorRef(a.ref);
    if (a.tipo === 'ci' && pr) poner({ id: `arreglar-ci:${a.ref}`, tipo: 'arreglar-ci', ref: a.ref, pr: pr.numero, ...tareaDe(pr), titulo: `Arreglar el CI del ${a.ref}`, ejecutor: 'agente', salida: 'push', escritura: true, peso: 'completo', prioridad: 2 });
    else if (a.tipo === 'revision-recibida' && pr) poner({ id: `aplicar-revision:${a.ref}`, tipo: 'aplicar-revision', ref: a.ref, pr: pr.numero, ...tareaDe(pr), titulo: `Aplicar la revisión del ${a.ref}`, ejecutor: 'agente', salida: 'push', escritura: true, peso: 'completo', prioridad: 2 });
    else if (a.tipo === 'formato' && pr) poner({ id: `corregir-formato:${a.ref}`, tipo: 'corregir-formato', ref: a.ref, pr: pr.numero, ...tareaDe(pr), titulo: `Corregir el formato del ${a.ref}`, ejecutor: 'agente', salida: 'editar-pr', escritura: false, peso: 'ligero', prioridad: 2, destino: String(pr.numero) });
    else if (a.tipo === 'entrega' && a.preparado) {
      const tarea = dia.tareas.find((t) => t.codigo === a.ref);
      const pr2 = dia.prs.find((p) => codigoDePr(p) === a.ref);
      if (tarea) poner({ id: `entregar:${a.ref}`, tipo: 'entregar', ref: a.ref, tarea: a.ref, ...(pr2 ? { pr: pr2.numero } : {}), titulo: `Comentar la entrega de ${a.ref}`, ejecutor: 'hilo', salida: 'comentario-clickup', escritura: false, peso: 'ligero', prioridad: 5, destino: tarea.id, texto: pr2?.sha ? a.preparado.replace('SHA probado: FALTA', `SHA probado: ${pr2.sha.slice(0, 7)}`) : a.preparado });
    } else if (a.tipo === 'bloqueo' && !pasos.has(`explicar-bloqueo:${a.ref}`) && idTarea(a.ref)) poner({ id: `explicar-bloqueo:${a.ref}`, tipo: 'explicar-bloqueo', ref: a.ref, tarea: a.ref, titulo: `Redactar el bloqueo de ${a.ref}`, ejecutor: 'agente', salida: 'comentario-clickup', escritura: false, peso: 'ligero', prioridad: 3, destino: idTarea(a.ref)! });
    else if (a.tipo === 'abrir-pr' && iniciar < maxIniciar) {
      iniciar++;
      poner({ id: `iniciar-tarea:${a.ref}`, tipo: 'iniciar-tarea', ref: a.ref, tarea: a.ref, titulo: `Hacer la primera pieza de ${a.ref}`, ejecutor: 'agente', salida: 'rama-y-pr', escritura: true, peso: 'completo', prioridad: 4 });
    } else if (a.tipo === 'revisar' && pr) poner({ id: `revisar-pr:${a.ref}`, tipo: 'revisar-pr', ref: a.ref, pr: pr.numero, ...tareaDe(pr), titulo: `Revisar el formato del ${a.ref}`, ejecutor: 'hilo', salida: 'comentario-github', escritura: false, peso: 'ligero', prioridad: 6, destino: String(pr.numero) });
  }
  return [...pasos.values()].sort((a, b) => a.prioridad - b.prioridad || a.ref.localeCompare(b.ref)).slice(0, maxPasos);
}

function tareaDe(pr: PrResumen): { tarea?: string } {
  const c = codigoDeTitulo(pr.titulo);
  return c ? { tarea: c } : {};
}

/** Los pasos gratuitos primero, luego los ligeros y al final los pesados: así lo barato nunca espera a lo caro. */
export function ordenDeEjecucion(pasos: PasoAuto[]): PasoAuto[] {
  const rango = (p: PasoAuto) => (p.ejecutor === 'hilo' ? 0 : p.peso === 'ligero' ? 1 : 2);
  return [...pasos].sort((a, b) => rango(a) - rango(b) || a.prioridad - b.prioridad);
}

// ---------- Modelo, tope y caché por paso ----------

/** Redactar es barato: un modelo ligero alcanza. Editar código usa el modelo de desarrollo del perfil. */
export function modeloDelPaso(p: PasoAuto, perfil: Perfil, a: Pick<AjustesAhorro, 'modeloEscalonado'>): ModeloAsignado {
  if (p.escritura || p.peso === 'completo') return perfil.modelos.desarrollo;
  return a.modeloEscalonado ? perfil.modelos.documentacion : perfil.modelos.integracion;
}

export const topeDelPaso = (p: PasoAuto, a: Pick<AjustesAhorro, 'topeUsdPaso'>): number => (p.peso === 'completo' ? a.topeUsdPaso : Math.max(0.05, Math.round(a.topeUsdPaso * 10) / 100));

/** Mismo paso, mismo commit y mismo texto: misma respuesta. No se vuelve a pagar. */
export function claveDePaso(p: PasoAuto, sha: string | undefined, prompt: string): string {
  return createHash('sha256').update(`${p.id}\n${sha ?? ''}\n${prompt}`).digest('hex').slice(0, 24);
}

// ---------- Prompts ----------

export interface ContextoPaso {
  tarea?: DetalleTarea;
  pr?: PrResumen;
  /** Cuerpo y título actuales del PR (para corregir formato). */
  titulo?: string;
  cuerpo?: string;
  digestoCi?: string;
  comentarios?: string;
  informe?: string;
  rama?: string;
  /** Lo que falló al verificar, comprimido, para el segundo intento. */
  fallaVerificacion?: string;
}

const cierre = 'Cuando termines, responde solo con el resultado final, sin preámbulos.';

function bloqueTarea(codigo: string | undefined, t?: DetalleTarea): string {
  if (!t) return codigo ? `## Tarea ${codigo}` : '';
  return [`## Tarea ${codigo ?? ''}: ${t.nombre}`, `Estado: ${t.estado}`, extractoRelevante(t.descripcion, 'objetivo entregables criterios aceptación dependencias alcance', 1400), t.comentarios.length ? `Últimos comentarios:\n${t.comentarios.slice(0, 3).map((c) => `- ${c.autor}: ${c.texto.slice(0, 220)}`).join('\n')}` : ''].filter(Boolean).join('\n');
}

export function promptDelPaso(p: PasoAuto, c: ContextoPaso, perfil: Perfil): string {
  const limite = perfil.limites.lineasPorPr;
  switch (p.tipo) {
    case 'arreglar-ci':
      return `Arregla el CI del PR ${p.ref}${p.tarea ? ` (${p.tarea})` : ''}. Esto es lo único que falló:\n\n${c.digestoCi ?? '(sin registro disponible: corre la verificación del proyecto para verlo)'}\n\nEdita lo mínimo para que pase, vuelve a correr solo la comprobación que falló y deja un commit con un mensaje claro. No toques nada que no esté relacionado. ${cierre}`;
    case 'aplicar-revision':
      return `Aplica los cambios que pidieron en la revisión del PR ${p.ref}${p.tarea ? ` (${p.tarea})` : ''}. Cada punto indica archivo y línea:\n\n${c.comentarios ?? '(sin comentarios legibles)'}\n\nResuelve cada punto con el cambio mínimo y una prueba si hace falta. Si alguno no se puede resolver sin una decisión de otra persona, dilo en lugar de adivinar. Deja un commit por tema. ${cierre}`;
    case 'iniciar-tarea':
      return `Haz la primera pieza de la tarea ${p.tarea} en la rama ${c.rama ?? '(la rama ya creada)'}. Tope: ${limite} líneas en total. Empieza por la prueba, luego el código; commits pequeños, uno por cosa. Usa solo datos de ejemplo, nunca datos reales. No publiques nada. Si algo del contrato no está claro, anótalo al final como pregunta en vez de inventarlo.\n\n${bloqueTarea(p.tarea, c.tarea)}${c.fallaVerificacion ? `\n\n## Falló la verificación anterior\n${c.fallaVerificacion}\nCorrige solo eso.` : ''}\n\n${cierre}`;
    case 'corregir-formato':
      return `Corrige el formato del PR ${p.ref} según estos errores y devuelve SOLO un JSON {"titulo":"...","cuerpo":"..."}, sin texto alrededor.\n\n## Errores\n${c.informe ?? ''}\n\n## Título actual\n${c.titulo ?? ''}\n\n## Cuerpo actual\n${(c.cuerpo ?? '').slice(0, 1800)}\n\nPrimera línea del cuerpo: ${perfil.cuerpo.primeraLinea}. Secciones: ${perfil.cuerpo.secciones.join(', ')}. No inventes datos: si falta algo, déjalo marcado con FALTA.`;
    case 'explicar-bloqueo':
      return `Redacta el comentario de bloqueo de la tarea ${p.tarea} con tres encabezados: "Causa:", "Se desbloquea con:" y "Depende de:". Usa solo lo que consta abajo; si algo no consta, escribe FALTA. Sin saludos.\n\n${bloqueTarea(p.tarea, c.tarea)}`;
    default:
      return `Ejecuta el paso ${p.titulo}. ${cierre}`;
  }
}
