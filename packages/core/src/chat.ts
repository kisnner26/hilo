import { extractoRelevante } from './ahorro.js';
import { quienMeBloquea, type Bloqueo } from './bloqueos.js';
import { buscarNodos, type GrafoG } from './analisis-grafo.js';
import { buscarNotas, type Nota } from './context.js';
import type { TareaClickup } from './clickup.js';
import type { MiDia, PrResumen } from './midia.js';
import type { Perfil } from './profile.js';
import { promptDeRol, type Estilo } from './roles.js';

/** Chat libre: lo que se contesta sin gastar tokens (datos que ya tenemos) y cómo se arma el contexto del agente. */

export type Intencion = 'mis-tareas' | 'mi-dia' | 'mis-prs' | 'saludo' | 'quien-bloquea' | 'piloto' | null;
export type AccionTarea = 'entender' | 'hacer' | 'revisar' | 'bloqueo';

export interface Tarjeta {
  tipo: 'tarea' | 'pr' | 'accion';
  titulo: string;
  detalle: string;
  /** Código de tarea o número de PR sobre el que actúan los botones. */
  ref: string;
  acciones: AccionTarea[];
}

export interface RespuestaInmediata {
  texto: string;
  tarjetas: Tarjeta[];
  pregunta?: string;
  /** Un botón que la interfaz dibuja bajo la respuesta. */
  accion?: 'piloto';
}

export interface DatosExtra {
  bloqueos?: Bloqueo[];
  /** Cuántos pasos tiene hoy el piloto automático. */
  pasosPiloto?: number;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Reconoce con reglas simples las preguntas que se pueden responder con datos que la app ya tiene. */
export function detectarIntencion(texto: string): Intencion {
  const t = norm(texto);
  if (/\bquien\s+(me\s+)?(esta\s+)?(bloquea|bloqueando|frena|frenando|detiene|atrasa)\b|\bque\s+me\s+(bloquea|frena|detiene)\b|\bpor\s+que\s+no\s+(puedo|logro)\s+avanzar\b|\bde\s+quien\s+(dependo|espero)\b/.test(t)) return 'quien-bloquea';
  if (/\b(haz(me)?|hac(e|er)(me)?|prepara(r|me)?|resuelve|ocupate\s+de|encargate\s+de)\b.*\b(pendientes|mis\s+tareas|todo)\b|\bpiloto(\s+automatico)?\b|\bhaz\s+mi\s+dia\b/.test(t)) return 'piloto';
  if (/\b(mis|mi)\s+(pr|prs|pull request|pull requests)\b|\bque\s+prs?\s+tengo\b/.test(t)) return 'mis-prs';
  if (/\bque\s+(tareas?|pendientes?)\s+(tengo|me\s+tocan|hay)\b|\bmis\s+tareas?\b|\bmi\s+tarea\b|\bque\s+me\s+toca\b|\bque\s+tengo\s+(que\s+hacer|pendiente)/.test(t)) return 'mis-tareas';
  if (/\bque\s+(hago|debo\s+hacer|toca\s+hacer|sigue)\b|\bmi\s+dia\b|\bpor\s+donde\s+empiezo\b|\bque\s+hago\s+hoy\b/.test(t)) return 'mi-dia';
  if (/^(hola|buenas|buenos dias|buenas tardes|hey|ayuda|que puedes hacer)\b/.test(t)) return 'saludo';
  return null;
}

const vence = (t: TareaClickup) => (t.vence ? ` · vence ${t.vence.slice(0, 10)}` : '');

export function respuestaDeIntencion(i: Exclude<Intencion, null>, dia: MiDia, extra: DatosExtra = {}): RespuestaInmediata {
  const prDe = (codigo: string) => dia.prs.find((p) => new RegExp(`^\\[${codigo}\\]`).test(p.titulo));
  if (i === 'saludo') {
    return {
      texto: `Hola, ${dia.saludo}. Soy el asistente del proyecto y sé tu rol (${dia.rol}), tus tareas de ClickUp y tus PR de GitHub. Puedes preguntarme lo que quieras: qué tarea tienes, qué hacer hoy, cómo entender una tarea, cómo revisar un PR, o dudas del código y del contrato.`,
      tarjetas: [],
    };
  }
  if (i === 'quien-bloquea') {
    const bs = extra.bloqueos ?? [];
    const culpables = quienMeBloquea(bs);
    const tuyos = bs.filter((b) => b.tuTurno);
    if (culpables.length === 0 && tuyos.length === 0) return { texto: 'Nadie te frena ahora mismo: no encontré dependencias abiertas ni PR esperando a otra persona.', tarjetas: [] };
    const partes = culpables.map((c) => `- **${c.quien}** frena ${c.tareas.join(', ')}${c.masAntiguo > 0 ? ` (hace ${c.masAntiguo} día${c.masAntiguo === 1 ? '' : 's'})` : ''}`);
    const tuTurno = tuyos.slice(0, 4).map((b) => `- ${b.tarea}: ${b.causa}`);
    return {
      texto: [culpables.length ? 'Esto es lo que te frena y quién lo destraba:' : '', ...partes, tuTurno.length ? '\nY esto depende de ti:' : '', ...tuTurno].filter(Boolean).join('\n'),
      tarjetas: [],
      ...((extra.pasosPiloto ?? 0) > 0 ? { pregunta: 'Puedo dejar redactados los recordatorios para cada uno: usa «Hacer mis pendientes».', accion: 'piloto' as const } : {}),
    };
  }
  if (i === 'piloto') {
    const n = extra.pasosPiloto ?? 0;
    if (n === 0) return { texto: 'No hay nada que preparar ahora mismo: ya estás al día.', tarjetas: [] };
    return { texto: `Tengo ${n} paso${n === 1 ? '' : 's'} listo${n === 1 ? '' : 's'} para prepararte. Los que no necesitan modelo salen gratis; lo que llega a otras personas queda en la bandeja hasta que lo apruebes.`, tarjetas: [], accion: 'piloto' };
  }
  if (i === 'mis-tareas') {
    if (dia.tareas.length === 0) return { texto: 'No tienes tareas abiertas asignadas en las listas que sigues. Si esperabas alguna, revisa en Ajustes qué listas de ClickUp seguir.', tarjetas: [] };
    return {
      texto: `Tienes ${dia.tareas.length} tarea${dia.tareas.length === 1 ? '' : 's'} abierta${dia.tareas.length === 1 ? '' : 's'} como ${dia.rol}:`,
      tarjetas: dia.tareas.slice(0, 8).map((t) => {
        const pr = prDe(t.codigo);
        const acciones: AccionTarea[] = ['entender', 'hacer'];
        if (pr) acciones.push('revisar');
        if (/block/i.test(t.estado)) acciones.push('bloqueo');
        return { tipo: 'tarea', titulo: `${t.codigo} · ${t.nombre.replace(/^[A-Z0-9-]+\s*[—–-]\s*/, '')}`, detalle: `${t.estado}${vence(t)}${pr ? ` · PR #${pr.numero} (CI ${pr.ci})` : ' · sin PR'}`, ref: t.codigo, acciones };
      }),
      pregunta: '¿Con cuál empezamos? Dime si quieres entenderla, hacerla o revisarla.',
    };
  }
  if (i === 'mis-prs') {
    if (dia.prs.length === 0) return { texto: 'No tienes PR abiertos.', tarjetas: [], pregunta: dia.tareas.length ? '¿Quieres que te ayude a empezar alguna de tus tareas?' : undefined };
    return {
      texto: `Tienes ${dia.prs.length} PR abierto${dia.prs.length === 1 ? '' : 's'}:`,
      tarjetas: dia.prs.map((p) => ({ tipo: 'pr', titulo: `#${p.numero} · ${p.titulo}`, detalle: `CI ${p.ci} · revisión ${p.revision}${p.erroresDeFormato ? ` · ${p.erroresDeFormato} error(es) de formato` : ''}${p.borrador ? ' · borrador' : ''}`, ref: String(p.numero), acciones: ['revisar'] })),
      pregunta: '¿Quieres que revise alguno antes de pedir revisión?',
    };
  }
  // mi-dia
  if (dia.acciones.length === 0) return { texto: 'Nada urgente: todo lo tuyo está al día. Si quieres, puedo ayudarte a avanzar la siguiente tarea.', tarjetas: [] };
  return {
    texto: 'Esto es lo más urgente, en orden:',
    tarjetas: dia.acciones.slice(0, 6).map((a) => ({
      tipo: 'accion',
      titulo: a.texto,
      detalle: a.tipo,
      ref: a.ref,
      acciones: a.tipo === 'revisar' || a.tipo === 'ci' || a.tipo === 'formato' || a.tipo === 'revision-recibida' ? ['revisar'] : a.tipo === 'bloqueo' ? ['bloqueo'] : ['entender', 'hacer'],
    })),
    pregunta: '¿Por cuál quieres que te ayude?',
  };
}

const lineaPr = (p: PrResumen) => `#${p.numero} ${p.titulo} (CI ${p.ci}, revisión ${p.revision}${p.borrador ? ', borrador' : ''}${p.erroresDeFormato ? `, ${p.erroresDeFormato} errores de formato` : ''})`;

/** Prompt de sistema del asistente: quién es la persona, qué le toca y las reglas. Va una vez por conversación. */
export function promptSistemaChat(perfil: Perfil, dia: MiDia, resumen: string, repo: string, estilo: Estilo = 'breve', permisos: 'lectura' | 'trabajo' | 'total' = 'lectura'): string {
  return [
    promptDeRol(dia.rol, perfil, estilo),
    `Hablas con ${dia.saludo}, rol ${dia.rol}, en ${repo}. Eres su asistente libre: puede preguntarte cualquier cosa del proyecto.`,
    'Si pregunta por sus tareas o qué hacer, responde con lo que está en "Sus datos" y cierra preguntando si quiere entenderla, hacerla o revisarla.',
    permisos === 'total'
      ? 'Tienes permisos completos, como Claude Code con los permisos abiertos: puedes ejecutar comandos, editar archivos, usar `gh` y `git` (incluido `git push`) y publicar cuando la persona lo pida. Actúa en lugar de proponer y al terminar di en pocas líneas qué hiciste. Antes de algo destructivo o que no se pueda deshacer, confirma.'
      : permisos === 'trabajo'
        ? 'Puedes leer GitHub con `gh pr view`, `gh pr diff` y `gh pr checks` (solo lectura), editar archivos del proyecto, correr pruebas y guardar commits locales. No publiques, ni hagas push, ni borres: si pide publicar, entrégale el texto listo para que lo publique desde la app.'
        : 'Trabajas en modo de solo lectura: propones, no ejecutas cambios ni publicas nada. Si pide publicar, entrégale el texto listo para que lo publique desde la app.',
    '## Sus datos',
    dia.tareas.length ? `Tareas: ${dia.tareas.map((t) => `${t.codigo} (${t.estado}${vence(t)})`).join('; ')}` : 'Tareas: ninguna abierta asignada.',
    dia.prs.length ? `PR suyos: ${dia.prs.map(lineaPr).join('; ')}` : 'PR suyos: ninguno abierto.',
    dia.paraRevisar.length ? `PR por revisar: ${dia.paraRevisar.slice(0, 6).map((p) => `#${p.numero} de ${p.autor}`).join('; ')}` : '',
    dia.acciones.length ? `Urgente: ${dia.acciones.slice(0, 5).map((a) => a.texto).join(' | ')}` : '',
    resumen,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface DetalleTarea {
  nombre: string;
  estado: string;
  descripcion: string;
  comentarios: { autor: string; texto: string }[];
}

/** Prompt del turno cuando la persona toca "entender", "hacer", "revisar" o "bloqueo" en una tarjeta. */
export function promptTarea(accion: AccionTarea, codigo: string, detalle: DetalleTarea | undefined, pr: PrResumen | undefined, informePr?: string, diff?: string): string {
  const desc = detalle ? extractoRelevante(detalle.descripcion, 'objetivo entregables criterios aceptación dependencias', 1400) : '';
  const tarea = detalle
    ? [`## Tarea ${codigo}: ${detalle.nombre}`, `Estado: ${detalle.estado}`, desc, detalle.comentarios.length ? `## Últimos comentarios\n${detalle.comentarios.map((c) => `- ${c.autor}: ${c.texto.slice(0, 280)}`).join('\n')}` : ''].filter(Boolean).join('\n')
    : `## Tarea ${codigo}`;
  if (accion === 'entender') return `Explícame la tarea ${codigo}: qué piden, criterios de aceptación, de qué depende y por dónde empezar. Usa solo lo de abajo y el código del repositorio; si algo no consta, dilo.\n\n${tarea}`;
  if (accion === 'hacer') return `Quiero hacer la tarea ${codigo}. Propón un plan en piezas de hasta 400 líneas, con la prueba primero, el nombre de la rama, los archivos que tocaría (léelos en el repositorio) y qué comprobar antes de abrir el PR. No modifiques archivos todavía.\n\n${tarea}`;
  if (accion === 'bloqueo') return `La tarea ${codigo} está bloqueada. Ayúdame a redactar el comentario de bloqueo con causa, qué lo desbloquea y de quién depende, usando el formato acordado. Pregúntame lo que no sepas.\n\n${tarea}`;
  return [
    `Revisa mi PR${pr ? ` #${pr.numero}` : ''} de la tarea ${codigo}. Dame una sola lista de cosas por corregir, ordenada por importancia, y di qué ya está bien.`,
    informePr ? `## Revisión de formato (automática)\n${informePr}` : '',
    diff ? `## Cambios (recortados)\n\`\`\`diff\n${diff}\n\`\`\`` : '',
    tarea,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Respuesta sin ninguna IA: busca en las notas y en el grafo y muestra lo que encontró.
 * Es lo que ve alguien que no tiene un agente ni un modelo local: poco, pero útil y sin gastar nada.
 */
export function respuestaSinIa(texto: string, notas: Nota[], grafo: GrafoG): RespuestaInmediata {
  const enNotas = buscarNotas(notas, texto, 3);
  const palabras = [...new Set(texto.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))].sort((a, b) => b.length - a.length).slice(0, 4);
  const vistos = new Set<string>();
  const enGrafo = palabras.flatMap((w) => buscarNodos(grafo, w, 5)).filter((n) => !vistos.has(n.id) && vistos.add(n.id)).slice(0, 5);
  const partes: string[] = [];
  if (enNotas.length > 0) {
    partes.push('Esto encontré en las notas del proyecto:');
    for (const x of enNotas) partes.push(`- **${x.nota.titulo}** (${x.nota.ruta})\n  ${extractoRelevante(x.nota.texto, texto, 320).replace(/\n+/g, ' ')}`);
  }
  if (enGrafo.length > 0) {
    partes.push(`${partes.length ? '\n' : ''}Y esto en el mapa del proyecto:`);
    for (const n of enGrafo) partes.push(`- ${n.label}${n.archivo ? ` (${n.archivo})` : ''}`);
  }
  if (partes.length === 0) partes.push('No encontré nada sobre eso en las notas ni en el mapa del proyecto.');
  partes.push('\n_No hay un modelo de IA activo, así que solo puedo buscar. Para que redacte y explique, conecta Claude Code o Codex, o activa un modelo en tu equipo en Ajustes › Modelos._');
  return { texto: partes.join('\n'), tarjetas: [] };
}
