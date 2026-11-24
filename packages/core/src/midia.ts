import type { TareaClickup } from './clickup.js';
import type { Perfil, RolId } from './profile.js';
import { codigoDeTitulo } from './profile.js';

/** Quién usa la app. Se deduce de las cuentas que conectó: su token de ClickUp y su sesión de GitHub. */
export interface Identidad {
  github?: string;
  clickupId?: number;
  clickupUsuario?: string;
}

export interface PrResumen {
  numero: number;
  titulo: string;
  autor: string;
  rama: string;
  borrador: boolean;
  url: string;
  /** Estado de los checks de construcción (reglas y builds); testing-ok y ci-ok no cuentan: dependen de una etiqueta. */
  ci: 'ok' | 'fallo' | 'pendiente';
  revision: 'aprobado' | 'cambios' | 'requerida' | 'ninguna';
  estadoFusion: string;
  pidenMiRevision: boolean;
  erroresDeFormato?: number;
  /** Último commit del PR: sirve para no revisar dos veces lo mismo. */
  sha?: string;
  /** Quién tiene pedida la revisión. */
  revisoresPedidos?: string[];
  /** Quién pidió cambios y no ha vuelto a opinar. */
  cambiosPedidosPor?: string[];
  aprobadoPor?: string[];
  /** La rama quedó atrás de la base: hay que actualizarla antes de fusionar. */
  atrasado?: boolean;
  /** Checks que dependen de una etiqueta (testing-ok, ci-ok) y aún no están en verde. */
  checksFaltantes?: string[];
  actualizado?: string;
  lineas?: number;
}

export type TipoSugerencia = 'ci' | 'formato' | 'revision-recibida' | 'bloqueo' | 'vencida' | 'abrir-pr' | 'entrega' | 'revisar' | 'espera';

export interface AccionSugerida {
  prioridad: number;
  tipo: TipoSugerencia;
  texto: string;
  /** Código de tarea o número de PR sobre el que actúa. */
  ref: string;
  /** Lo que Hilo ya dejó preparado (por ejemplo, la plantilla del comentario). */
  preparado?: string;
}

export interface MiDia {
  saludo: string;
  rol: RolId;
  tareas: TareaClickup[];
  prs: PrResumen[];
  paraRevisar: PrResumen[];
  acciones: AccionSugerida[];
}

const CERRADA = /^(completed|closed|complete|done)$/i;

export function rolDeTarea(codigo: string): RolId {
  if (/-TEST(-|$)/.test(codigo)) return 'tester';
  if (/-INT(-|$)/.test(codigo) || /^INT-/.test(codigo)) return 'integrador';
  if (/(^|-)DOC-|^REV-|^UI-/.test(codigo)) return 'documentador';
  return 'desarrollador';
}

/** El rol más frecuente entre las tareas abiertas de la persona. Un integrador conocido por perfil siempre lo es. */
export function inferirRol(mias: TareaClickup[], yo: Identidad, perfil: Perfil, forzado?: RolId): RolId {
  if (forzado) return forzado;
  if (yo.github && perfil.integradores.includes(yo.github)) return 'integrador';
  const cuenta = new Map<RolId, number>();
  for (const t of mias) cuenta.set(rolDeTarea(t.codigo), (cuenta.get(rolDeTarea(t.codigo)) ?? 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'desarrollador';
}

const primerNombre = (u?: string) => {
  const p = (u ?? '').trim().split(/\s+/)[0] ?? '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
};

export const tareaCerrada = (estado: string): boolean => CERRADA.test(estado);

/** Las tareas abiertas asignadas a la persona, por su id de ClickUp o por su usuario. */
export function tareasDe(tareas: TareaClickup[], yo: Identidad): TareaClickup[] {
  return tareas.filter((t) => !CERRADA.test(t.estado) && ((yo.clickupId !== undefined && t.asignadosIds?.includes(yo.clickupId)) || (yo.clickupUsuario && t.asignados.includes(yo.clickupUsuario))));
}

const vencida = (t: TareaClickup, ahora: Date) => Boolean(t.vence) && new Date(t.vence!).getTime() < ahora.getTime();

/**
 * Cruza las tareas de ClickUp con los PR de GitHub por el código de tarea y decide qué hace falta hacer hoy.
 * Las acciones salen ordenadas: primero lo que bloquea a otros.
 */
export function miDia(tareas: TareaClickup[], prs: PrResumen[], yo: Identidad, perfil: Perfil, ahora = new Date(), rolForzado?: RolId): MiDia {
  const mias = tareasDe(tareas, yo);
  const misPrs = prs.filter((p) => yo.github && p.autor === yo.github);
  const rol = inferirRol(mias, yo, perfil, rolForzado);
  const prDe = (codigo: string) => prs.find((p) => codigoDeTitulo(p.titulo) === codigo && p.autor === yo.github) ?? prs.find((p) => codigoDeTitulo(p.titulo) === codigo);
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const acciones: AccionSugerida[] = [];

  for (const p of misPrs) {
    if (p.ci === 'fallo') acciones.push({ prioridad: 1, tipo: 'ci', ref: `#${p.numero}`, texto: `El CI del #${p.numero} falló: corrígelo antes de pedir revisión.` });
    if ((p.erroresDeFormato ?? 0) > 0) acciones.push({ prioridad: 2, tipo: 'formato', ref: `#${p.numero}`, texto: `El #${p.numero} tiene ${p.erroresDeFormato} error(es) de formato: corrígelos de una vez.` });
    if (p.revision === 'cambios') acciones.push({ prioridad: 2, tipo: 'revision-recibida', ref: `#${p.numero}`, texto: `Te pidieron cambios en el #${p.numero}.` });
  }
  for (const t of mias) {
    const pr = prDe(t.codigo);
    if (/block/i.test(t.estado)) {
      acciones.push({ prioridad: 3, tipo: 'bloqueo', ref: t.codigo, texto: `${t.codigo} está bloqueada: escribe la causa y qué la desbloquea.`, preparado: `Bloqueo ${t.codigo}\n\nCausa: \nSe desbloquea con: \nDepende de: ` });
    } else if (vencida(t, ahora)) {
      acciones.push({ prioridad: 3, tipo: 'vencida', ref: t.codigo, texto: `${t.codigo} venció el ${t.vence!.slice(0, 10)}: entrega o avisa una fecha nueva.` });
    }
    const pendientes = t.dependeDe.map((d) => porId.get(d)).filter((d): d is TareaClickup => Boolean(d) && !CERRADA.test(d!.estado));
    if (pendientes.length > 0 && !pr) {
      acciones.push({ prioridad: 6, tipo: 'espera', ref: t.codigo, texto: `${t.codigo} espera a ${pendientes.map((d) => d.codigo).join(', ')}.` });
    } else if (!pr && /^(open|in progress|to do|pending)$/i.test(t.estado)) {
      acciones.push({ prioridad: 4, tipo: 'abrir-pr', ref: t.codigo, texto: `${t.codigo} no tiene PR: abre uno en borrador con la primera pieza (hasta ${perfil.limites.lineasPorPr} líneas).` });
    } else if (pr && !/review/i.test(t.estado)) {
      acciones.push({
        prioridad: 5,
        tipo: 'entrega',
        ref: t.codigo,
        texto: `${t.codigo} tiene el PR #${pr.numero} pero sigue en "${t.estado}": comenta la entrega.`,
        preparado: `Entrega ${t.codigo}\n\nEnlace: ${pr.url}\nSHA probado: FALTA\n\nContribución de cada participante:\n- ${t.asignados.join(', ') || 'FALTA'}\n\nPendiente del equipo (Integración, Testing, Documentación):\n- testing-ok y revisión de Integración`,
      });
    }
  }
  const paraRevisar = prs.filter((p) => p.autor !== yo.github && !p.borrador && (p.pidenMiRevision || rol === 'integrador') && p.revision !== 'aprobado');
  if (rol === 'integrador' || paraRevisar.some((p) => p.pidenMiRevision)) {
    for (const p of paraRevisar.slice(0, 8)) acciones.push({ prioridad: 5, tipo: 'revisar', ref: `#${p.numero}`, texto: `Revisa el #${p.numero} de ${p.autor}${p.ci === 'fallo' ? ' (su CI falló: espera)' : ''}.` });
  }
  acciones.sort((a, b) => a.prioridad - b.prioridad);
  return { saludo: primerNombre(yo.clickupUsuario) || yo.github || 'hola', rol, tareas: mias, prs: misPrs, paraRevisar, acciones };
}

/** Estado de CI sin contar los checks que dependen de una etiqueta (testing-ok, ci-ok). */
export function estadoCi(checks: { name: string; conclusion?: string | null; status?: string }[]): PrResumen['ci'] {
  const propios = checks.filter((c) => !/^(testing-ok|ci-ok)$/.test(c.name));
  if (propios.some((c) => /^(FAILURE|CANCELLED|TIMED_OUT)$/i.test(c.conclusion ?? ''))) return 'fallo';
  if (propios.some((c) => !c.conclusion || /^(IN_PROGRESS|QUEUED|PENDING)$/i.test(c.status ?? ''))) return 'pendiente';
  return 'ok';
}
