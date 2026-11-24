import type { TareaClickup } from './clickup.js';
import { tareaCerrada, tareasDe, type Identidad, type PrResumen } from './midia.js';
import { codigoDeTitulo, type Perfil } from './profile.js';

/**
 * Quién te frena y qué hace falta para seguir. Se calcula solo con datos que la app ya tiene
 * (dependencias de ClickUp, revisiones y checks de GitHub): no gasta tokens.
 */

export type TipoBloqueo = 'dependencia' | 'ci' | 'cambios-pedidos' | 'espera-revision' | 'espera-testing' | 'rama-atrasada' | 'estado-bloqueada';

export interface Bloqueo {
  tipo: TipoBloqueo;
  /** Código de la tarea que queda frenada. */
  tarea: string;
  pr?: number;
  causa: string;
  /** Quién lo desbloquea. Vacío: depende de ti. */
  quien: string[];
  tuTurno: boolean;
  /** Días que lleva así, cuando se puede saber. */
  dias: number;
  /** Lo que Hilo puede resolver solo, sin pedir nada a nadie. */
  automatico?: 'actualizar-rama';
  /** Dónde se deja el aviso a quien te frena. */
  canal?: 'github' | 'clickup';
  /** Mensaje listo para avisarle, en el tono del equipo. */
  recordatorio?: string;
}

const DIA = 86_400_000;

const dias = (desde: string | undefined, ahora: Date): number => (desde ? Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / DIA)) : 0);

const lista = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

const prDeTarea = (codigo: string, prs: PrResumen[], yo: Identidad): PrResumen | undefined =>
  prs.find((p) => codigoDeTitulo(p.titulo) === codigo && p.autor === yo.github) ?? prs.find((p) => codigoDeTitulo(p.titulo) === codigo);

export function analizarBloqueos(tareas: TareaClickup[], prs: PrResumen[], yo: Identidad, perfil: Perfil, ahora = new Date()): Bloqueo[] {
  const mias = tareasDe(tareas, yo);
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const salida: Bloqueo[] = [];

  for (const t of mias) {
    const pr = prDeTarea(t.codigo, prs, yo);
    const propio = pr?.autor === yo.github;

    const pendientes = t.dependeDe.map((d) => porId.get(d)).filter((d): d is TareaClickup => Boolean(d) && !tareaCerrada(d!.estado));
    if (pendientes.length > 0) {
      const quien = [...new Set(pendientes.flatMap((d) => d.asignados))];
      salida.push({
        tipo: 'dependencia',
        tarea: t.codigo,
        causa: `Depende de ${pendientes.map((d) => `${d.codigo} (${d.estado})`).join(', ')}.`,
        quien,
        tuTurno: false,
        dias: 0,
        canal: 'clickup',
        recordatorio: `${t.codigo} está esperando a ${pendientes.map((d) => d.codigo).join(', ')}. ¿Cuál es la fecha estimada para poder seguir${quien.length ? `, ${lista(quien)}` : ''}? Si hay algo que lo destrabe, avisen aquí.`,
      });
    } else if (/block/i.test(t.estado)) {
      salida.push({ tipo: 'estado-bloqueada', tarea: t.codigo, causa: 'Está marcada como bloqueada y no hay una dependencia abierta que lo explique: falta escribir la causa.', quien: [], tuTurno: true, dias: 0, canal: 'clickup' });
    }

    if (!pr || !propio) continue;

    if (pr.ci === 'fallo') salida.push({ tipo: 'ci', tarea: t.codigo, pr: pr.numero, causa: `El CI del #${pr.numero} falló.`, quien: [], tuTurno: true, dias: dias(pr.actualizado, ahora) });
    if ((pr.cambiosPedidosPor?.length ?? 0) > 0) {
      salida.push({ tipo: 'cambios-pedidos', tarea: t.codigo, pr: pr.numero, causa: `${lista(pr.cambiosPedidosPor!)} pidió cambios en el #${pr.numero}.`, quien: pr.cambiosPedidosPor!, tuTurno: true, dias: dias(pr.actualizado, ahora) });
    }
    if (pr.atrasado) salida.push({ tipo: 'rama-atrasada', tarea: t.codigo, pr: pr.numero, causa: `La rama del #${pr.numero} quedó atrás de ${perfil.repo.base}.`, quien: [], tuTurno: true, dias: 0, automatico: 'actualizar-rama' });
    if (pr.borrador) continue;

    const espera = dias(pr.actualizado, ahora);
    const sinCambios = (pr.cambiosPedidosPor?.length ?? 0) === 0;
    if (sinCambios && pr.ci !== 'fallo' && pr.revision !== 'aprobado') {
      const quien = pr.revisoresPedidos?.length ? pr.revisoresPedidos : perfil.integradores;
      salida.push({
        tipo: 'espera-revision',
        tarea: t.codigo,
        pr: pr.numero,
        causa: `El #${pr.numero} espera la revisión de ${lista(quien)}${espera > 0 ? ` desde hace ${espera} día${espera === 1 ? '' : 's'}` : ''}.`,
        quien,
        tuTurno: false,
        dias: espera,
        canal: 'github',
        recordatorio: `${quien.map((q) => `@${q}`).join(' ')} cuando puedan, ¿revisan el #${pr.numero} (${t.codigo})? El CI está ${pr.ci === 'ok' ? 'en verde' : 'corriendo'}${pr.atrasado ? ' y la rama se está actualizando' : ' y la rama está al día'}. Si falta algo para poder revisarlo, díganme y lo ajusto hoy.`,
      });
    }
    if (sinCambios && pr.ci === 'ok' && (pr.checksFaltantes ?? []).includes('testing-ok')) {
      salida.push({
        tipo: 'espera-testing',
        tarea: t.codigo,
        pr: pr.numero,
        causa: `Al #${pr.numero} le falta testing-ok: Testing debe dar conformidad sobre el último commit.`,
        quien: ['Testing'],
        tuTurno: false,
        dias: espera,
        canal: 'github',
        recordatorio: `Testing: el #${pr.numero} (${t.codigo}) tiene el CI en verde y espera conformidad sobre ${pr.sha ? pr.sha.slice(0, 7) : 'el último commit'}. ¿Pueden darle prioridad? Dejo aquí los pasos para reproducir si hacen falta.`,
      });
    }
  }

  return salida.sort((a, b) => Number(b.tuTurno) - Number(a.tuTurno) || b.dias - a.dias || a.tarea.localeCompare(b.tarea));
}

export interface Culpable {
  quien: string;
  bloqueos: number;
  tareas: string[];
  masAntiguo: number;
}

/** Agrupa por persona a quien te frena, la que más trabajo tuyo detiene primero. */
export function quienMeBloquea(bloqueos: Bloqueo[]): Culpable[] {
  const mapa = new Map<string, Culpable>();
  for (const b of bloqueos.filter((x) => !x.tuTurno)) {
    for (const q of b.quien) {
      const c = mapa.get(q) ?? { quien: q, bloqueos: 0, tareas: [], masAntiguo: 0 };
      c.bloqueos += 1;
      if (!c.tareas.includes(b.tarea)) c.tareas.push(b.tarea);
      c.masAntiguo = Math.max(c.masAntiguo, b.dias);
      mapa.set(q, c);
    }
  }
  return [...mapa.values()].sort((a, b) => b.tareas.length - a.tareas.length || b.masAntiguo - a.masAntiguo || a.quien.localeCompare(b.quien));
}

/** Un recordatorio solo se sugiere si lleva esperando lo suficiente: no se insiste a quien acaba de recibir el PR. */
export const merecePedirAvance = (b: Bloqueo, minimoDias = 2): boolean => !b.tuTurno && Boolean(b.recordatorio) && (b.tipo === 'dependencia' || b.dias >= minimoDias);
