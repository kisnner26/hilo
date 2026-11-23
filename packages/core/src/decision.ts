import type { Perfil, RolId } from './profile.js';

/** Un dato verificado con su origen. Es lo único que el agente puede afirmar sin volver a comprobar. */
export interface Hecho {
  clave: string;
  valor: string | number | boolean;
  fuente: string;
  visto: string;
  /** Horas durante las que sigue valiendo; después hay que verificarlo de nuevo. */
  vigenciaHoras?: number;
}

export type TipoAccion =
  | 'leer'
  | 'proponer'
  | 'comentar'
  | 'cambiar-estado'
  | 'abrir-pr'
  | 'aprobar'
  | 'fusionar'
  | 'etiquetar-testing'
  | 'editar-codigo';

/** Las acciones que cambian algo fuera de la sesión y llegan a otras personas. */
const CON_EFECTO: TipoAccion[] = ['comentar', 'cambiar-estado', 'abrir-pr', 'aprobar', 'fusionar', 'etiquetar-testing'];

const CAPACIDAD: Record<TipoAccion, string> = {
  leer: 'leer',
  proponer: 'comentar',
  comentar: 'comentar',
  'cambiar-estado': 'comentar',
  'abrir-pr': 'abrir-pr',
  aprobar: 'aprobar',
  fusionar: 'fusionar',
  'etiquetar-testing': 'etiquetar-testing',
  'editar-codigo': 'codigo',
};

export interface Afirmacion {
  texto: string;
  /** Si la afirmación sale de un hecho del registro. */
  hechoClave?: string;
  valor?: string | number | boolean;
  /** Origen verificable: URL, archivo:línea, nodo del grafo, comentario. */
  fuente?: string;
}

export interface Accion {
  tipo: TipoAccion;
  rol: RolId;
  objetivo: string;
  afirmaciones: Afirmacion[];
  humanoAprobo?: boolean;
  /** Para fusionar: código de tarea, para saber si exige testing-ok. */
  codigoTarea?: string;
}

export type Veredicto = 'permitir' | 'preguntar' | 'bloquear';

export interface Decision {
  veredicto: Veredicto;
  razones: string[];
  /** Afirmaciones que el agente debe comprobar antes de seguir. */
  porVerificar: string[];
  /** Fracción de afirmaciones con evidencia, de 0 a 1. */
  respaldo: number;
}

function vigente(h: Hecho, ahora: Date): boolean {
  if (h.vigenciaHoras === undefined) return true;
  return ahora.getTime() - new Date(h.visto).getTime() <= h.vigenciaHoras * 3_600_000;
}

/**
 * Capa de decisión sin modelo: reglas explícitas y un registro de hechos con origen.
 * No sustituye el criterio de nadie; decide cuándo el agente puede seguir, cuándo debe preguntar
 * y cuándo debe parar porque se contradice con algo ya comprobado.
 */
export function decidir(a: Accion, p: Perfil, hechos: Hecho[], ahora = new Date()): Decision {
  const razones: string[] = [];
  const porVerificar: string[] = [];
  const registro = new Map(hechos.map((h) => [h.clave, h]));

  // 1. Permisos del rol.
  const rol = p.roles[a.rol];
  const cap = CAPACIDAD[a.tipo];
  if (rol.noPuede.includes(cap) || (!rol.puede.includes(cap) && a.tipo !== 'leer')) {
    return { veredicto: 'bloquear', razones: [`El rol ${a.rol} no puede "${a.tipo}".`], porVerificar, respaldo: 0 };
  }

  // 2. Afirmaciones contra el registro.
  let conRespaldo = 0;
  for (const f of a.afirmaciones) {
    if (f.hechoClave) {
      const h = registro.get(f.hechoClave);
      if (!h) {
        porVerificar.push(`${f.texto} (no hay hecho "${f.hechoClave}" registrado)`);
        continue;
      }
      if (f.valor !== undefined && String(h.valor) !== String(f.valor)) {
        return {
          veredicto: 'bloquear',
          razones: [`Contradicción: "${f.texto}" dice ${String(f.valor)} pero ${h.fuente} registró ${String(h.valor)} para ${h.clave}.`],
          porVerificar,
          respaldo: 0,
        };
      }
      if (!vigente(h, ahora)) {
        porVerificar.push(`${f.texto} (el dato "${h.clave}" tiene más de ${h.vigenciaHoras} h; vuelve a comprobarlo en ${h.fuente})`);
        continue;
      }
      conRespaldo++;
    } else if (f.fuente) {
      conRespaldo++;
    } else {
      porVerificar.push(`${f.texto} (sin fuente)`);
    }
  }
  const respaldo = a.afirmaciones.length === 0 ? 1 : conRespaldo / a.afirmaciones.length;

  // 3. Requisitos para fusionar.
  if (a.tipo === 'fusionar') {
    const falta: string[] = [];
    const ok = (k: string) => registro.get(k)?.valor === true || registro.get(k)?.valor === 'ok';
    if (!ok('ci-ok')) falta.push('ci-ok verde');
    if (!ok('aprobacion-code-owner')) falta.push('aprobación de un Code Owner que no sea el autor');
    if (a.codigoTarea) {
      const exige = new RegExp(p.testing.exigidoPara).test(a.codigoTarea) && !new RegExp(p.testing.exentos).test(a.codigoTarea);
      if (exige && !ok('testing-ok')) falta.push(`etiqueta ${p.testing.etiqueta}`);
    }
    if (falta.length > 0) {
      return { veredicto: 'bloquear', razones: [`No se puede fusionar: falta ${falta.join(', ')}.`], porVerificar, respaldo };
    }
  }

  // 4. Efectos fuera de la sesión: siempre con aprobación explícita de una persona.
  if (CON_EFECTO.includes(a.tipo) && !a.humanoAprobo) {
    razones.push(`"${a.tipo}" llega a otras personas: necesita aprobación explícita antes de ejecutarse.`);
    return { veredicto: 'preguntar', razones, porVerificar, respaldo };
  }

  if (porVerificar.length > 0) {
    razones.push('Hay afirmaciones sin respaldo: se comprueban antes de seguir.');
    return { veredicto: CON_EFECTO.includes(a.tipo) ? 'preguntar' : 'permitir', razones, porVerificar, respaldo };
  }
  return { veredicto: 'permitir', razones: ['Dentro del rol, con respaldo para lo que se afirma.'], porVerificar, respaldo };
}
