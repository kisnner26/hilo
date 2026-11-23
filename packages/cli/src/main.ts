#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asignar,
  buscarNotas,
  cambioDesdeGit,
  cargarBoveda,
  cargarGrafo,
  cargarHilo,
  cargarPerfil,
  comentarioClickup,
  conDecision,
  conPaso,
  decidir,
  desbordes,
  estadistica,
  estadoSesion,
  formatearInforme,
  grafoDeBoveda,
  guardarHilo,
  informe,
  listarHilos,
  marcarPaso,
  nuevoHilo,
  paqueteDeContexto,
  planificar,
  recordatorio,
  unirGrafos,
  validarComentario,
  type Accion,
  type Alcance,
  type Cambio,
  type Hecho,
  type PrEnCola,
  type RolId,
  type TareaPlan,
  type TipoComentario,
} from '@hilo/core';

type Opciones = Record<string, string | true>;

function leerArgs(argv: string[]): { pos: string[]; op: Opciones } {
  const pos: string[] = [];
  const op: Opciones = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const sig = argv[i + 1];
      if (sig !== undefined && !sig.startsWith('--')) {
        op[k] = sig;
        i++;
      } else op[k] = true;
    } else pos.push(a);
  }
  return { pos, op };
}

const aquí = dirname(fileURLToPath(import.meta.url));
const raizPaquete = resolve(aquí, '../../..');
const texto = (v: string | true | undefined, def = '') => (typeof v === 'string' ? v : def);
const leerStdin = (): string => (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'));

function perfilDe(op: Opciones) {
  const ruta = texto(op.perfil, process.env.HILO_PERFIL ?? join(raizPaquete, 'profiles', 'sistema-evaluaciones.json'));
  return cargarPerfil(ruta);
}
const raizDatos = (op: Opciones) => resolve(texto(op.raiz, process.env.HILO_HOME ?? process.cwd()));

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Trae un PR de GitHub como Cambio: la misma revisión que hoy se hace a mano, en un solo informe. */
function cambioDePr(numero: string, repo: string): Cambio {
  const meta = JSON.parse(gh('pr', 'view', numero, '-R', repo, '--json', 'headRefName,title,body,labels')) as {
    headRefName: string;
    title: string;
    body: string;
    labels: { name: string }[];
  };
  const archivos = JSON.parse(gh('api', `repos/${repo}/pulls/${numero}/files`, '--paginate', '--jq', '[.[]|{ruta:.filename,estado:(if .status=="added" then "A" elif .status=="removed" then "D" elif .status=="renamed" then "R" else "M" end),adiciones:.additions,eliminaciones:.deletions}]')) as Cambio['archivos'];
  return { rama: meta.headRefName, titulo: meta.title, cuerpo: meta.body ?? '', archivos, etiquetas: meta.labels.map((l) => l.name) };
}

const AYUDA = `hilo — contexto, formatos y decisión para el equipo

  hilo revisar <PR> [--repo dueño/nombre]     revisa un PR de GitHub contra todas las reglas y entrega una sola lista
  hilo preflight [--titulo T] [--cuerpo F]    revisa la rama actual antes de abrir el PR
  hilo comentario <tipo> --codigo C ...       arma un comentario de ClickUp (avance|entrega|bloqueo|pregunta|integracion)
  hilo comentario-validar <tipo> [--participantes N]   revisa un comentario recibido por stdin
  hilo contexto --grafo G [--boveda DIR] [--rol R] [--alcance todo|comunidad:N|vecindad:NODO] [--presupuesto N] [--consulta TEXTO]
  hilo hilo nuevo <id> --rol R --objetivo T [--tarea C] | ver <id> | paso <id> T | hecho <id> N | decidir <id> T --motivo M | lista
  hilo decidir --hechos F.json                accion por stdin (JSON): veredicto permitir, preguntar o bloquear
  hilo plan --tareas F.json [--dias 10] [--capacidad 500]    plan XP por días
  hilo cola --cola F.json                     reparto entre integradores y métricas de rondas
  hilo sesion                                 estado de Claude Code y Codex (suscripción)
  hilo instalar-skill [--destino DIR]         instala la skill /hilo para Claude Code
`;

async function main() {
  const { pos, op } = leerArgs(process.argv.slice(2));
  const [cmd, ...resto] = pos;
  if (!cmd || cmd === 'ayuda' || op.help) return void console.log(AYUDA);
  const perfil = perfilDe(op);
  const repo = texto(op.repo, `${perfil.repo.owner}/${perfil.repo.name}`);

  switch (cmd) {
    case 'revisar': {
      const n = resto[0];
      if (!n) throw new Error('Falta el número de PR.');
      const i = informe(cambioDePr(n, repo), perfil);
      console.log(formatearInforme(i));
      process.exitCode = i.ok ? 0 : 1;
      return;
    }
    case 'preflight': {
      const cuerpo = op.cuerpo ? readFileSync(texto(op.cuerpo), 'utf8') : '';
      const c = cambioDesdeGit(process.cwd(), perfil, { ...(op.titulo ? { titulo: texto(op.titulo) } : {}), cuerpo });
      const i = informe(c, perfil);
      console.log(formatearInforme(i));
      process.exitCode = i.ok ? 0 : 1;
      return;
    }
    case 'comentario': {
      const tipo = resto[0] as TipoComentario;
      const lista = (k: string) => (typeof op[k] === 'string' ? texto(op[k]).split('|').map((x) => x.trim()) : undefined);
      console.log(
        comentarioClickup({
          tipo,
          codigo: texto(op.codigo, 'FALTA'),
          ...(op.enlace ? { enlace: texto(op.enlace) } : {}),
          ...(op.sha ? { sha: texto(op.sha) } : {}),
          ...(op.causa ? { causa: texto(op.causa) } : {}),
          ...(op.desbloquea ? { desbloqueaCon: texto(op.desbloquea) } : {}),
          ...(op.quien ? { quien: texto(op.quien) } : {}),
          ...(op.fecha ? { fecha: texto(op.fecha) } : {}),
          ...(lista('hecho') ? { hecho: lista('hecho') as string[] } : {}),
          ...(lista('pendientes') ? { pendientes: lista('pendientes') as string[] } : {}),
          ...(lista('contribuciones') ? { contribuciones: lista('contribuciones') as string[] } : {}),
        }),
      );
      return;
    }
    case 'comentario-validar': {
      const faltas = validarComentario(leerStdin(), (resto[0] ?? 'avance') as TipoComentario, perfil, Number(texto(op.participantes, '1')));
      console.log(faltas.length === 0 ? 'Comentario completo.' : faltas.map((f) => `- ${f}`).join('\n'));
      process.exitCode = faltas.length === 0 ? 0 : 1;
      return;
    }
    case 'contexto': {
      let g = existsSync(texto(op.grafo)) ? cargarGrafo(texto(op.grafo)) : { nodos: [], enlaces: [] };
      const notas = op.boveda ? cargarBoveda(resolve(texto(op.boveda))) : [];
      if (notas.length > 0) g = unirGrafos(g, grafoDeBoveda(notas));
      const a = texto(op.alcance, 'todo');
      const alcance: Alcance = a.startsWith('comunidad:')
        ? { tipo: 'comunidad', id: Number(a.split(':')[1]) }
        : a.startsWith('vecindad:')
          ? { tipo: 'vecindad', nodo: a.slice('vecindad:'.length), saltos: 2 }
          : { tipo: 'todo' };
      const h = op.hilo ? cargarHilo(raizDatos(op), texto(op.hilo)) : undefined;
      const fijo = h ? recordatorio(h) : '';
      const p = paqueteDeContexto(g, { alcance, ...(op.rol ? { rol: texto(op.rol) as RolId } : {}), conciso: op.detallado !== true, sinRuido: op['con-ruido'] !== true, ...(op.consulta ? { consulta: texto(op.consulta) } : {}), presupuesto: Number(texto(op.presupuesto, '2000')) }, fijo);
      const extra = op.consulta && notas.length > 0 ? buscarNotas(notas, texto(op.consulta), 3).map((x) => `\n## ${x.nota.titulo} (${x.nota.ruta})\n${x.nota.texto.slice(0, 1200)}`).join('\n') : '';
      console.log(p.texto + extra);
      console.error(`~${p.tokens} tokens · ${p.nodos} nodos${p.recortado ? ' · recortado por presupuesto' : ''}`);
      return;
    }
    case 'hilo': {
      const [sub, id, ...r] = resto;
      const raiz = raizDatos(op);
      if (sub === 'lista') return void console.log(listarHilos(raiz).map((h) => `${h.id}  ${h.rol}  ${h.objetivo}`).join('\n') || 'Sin hilos.');
      if (!id) throw new Error('Falta el id del hilo.');
      if (sub === 'nuevo') {
        guardarHilo(raiz, nuevoHilo(id, texto(op.rol, 'desarrollador') as RolId, texto(op.objetivo, 'sin objetivo'), op.tarea ? texto(op.tarea) : undefined));
        return void console.log(`Hilo ${id} creado.`);
      }
      const h = cargarHilo(raiz, id);
      if (!h) throw new Error(`No existe el hilo ${id}.`);
      if (sub === 'ver') return void console.log(recordatorio(h));
      if (sub === 'paso') guardarHilo(raiz, conPaso(h, r.join(' ')));
      else if (sub === 'hecho') guardarHilo(raiz, marcarPaso(h, Number(r[0]) - 1));
      else if (sub === 'decidir') guardarHilo(raiz, conDecision(h, r.join(' '), texto(op.motivo, 'sin motivo')));
      else throw new Error(`Subcomando de hilo desconocido: ${sub}`);
      return void console.log(recordatorio(cargarHilo(raiz, id) ?? h));
    }
    case 'decidir': {
      const hechos = op.hechos ? (JSON.parse(readFileSync(texto(op.hechos), 'utf8')) as Hecho[]) : [];
      const d = decidir(JSON.parse(leerStdin()) as Accion, perfil, hechos);
      console.log(JSON.stringify(d, null, 2));
      process.exitCode = d.veredicto === 'bloquear' ? 2 : d.veredicto === 'preguntar' ? 1 : 0;
      return;
    }
    case 'plan': {
      const tareas = JSON.parse(readFileSync(texto(op.tareas), 'utf8')) as TareaPlan[];
      const dias = Number(texto(op.dias, '10'));
      const cap = Number(texto(op.capacidad, '500'));
      const plan = planificar(tareas, dias, cap, perfil.limites.lineasPorPr);
      for (const d of plan) {
        if (d.piezas.length > 0) console.log(`Día ${d.dia}: ${d.piezas.map((p) => `${p.codigo} ${p.pieza} (${p.lineas})`).join('; ')}`);
      }
      const d = desbordes(plan, cap);
      if (d.length > 0) console.log(`Días sobre la capacidad: ${d.join(', ')}. Recorta alcance o sube la capacidad.`);
      return;
    }
    case 'cola': {
      const cola = JSON.parse(readFileSync(texto(op.cola), 'utf8')) as PrEnCola[];
      console.log(JSON.stringify({ asignaciones: asignar(cola, perfil.integradores), metricas: estadistica(cola, perfil.integradores) }, null, 2));
      return;
    }
    case 'sesion': {
      for (const cli of ['claude', 'codex'] as const) {
        const s = await estadoSesion(cli);
        console.log(`${cli}: ${s.instalado ? (s.conectado ? 'conectado' : 'sin sesión') : 'no instalado'} — ${s.detalle}`);
      }
      return;
    }
    case 'instalar-skill': {
      const destino = resolve(texto(op.destino, join(homedir(), '.claude', 'skills', 'hilo')));
      const plantilla = readFileSync(join(raizPaquete, 'skill', 'hilo', 'SKILL.md'), 'utf8');
      mkdirSync(destino, { recursive: true });
      writeFileSync(join(destino, 'SKILL.md'), plantilla.replaceAll('{{HILO}}', `node ${join(aquí, 'main.js')}`));
      console.log(`Skill instalada en ${destino}. Úsala con /hilo.`);
      return;
    }
    default:
      throw new Error(`Comando desconocido: ${cmd}\n\n${AYUDA}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 3;
});
