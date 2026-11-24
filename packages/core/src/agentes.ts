import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CliId, Esfuerzo, ModeloAsignado, Perfil, RolId } from './profile.js';
import { usoDeLinea, type UsoAgente } from './uso.js';

const exec = promisify(execFile);

/**
 * Hilo no guarda ni usa claves ni tokens. Cada integrante inicia sesión en la CLI oficial con su
 * suscripción (`claude auth login`, `codex login`) y Hilo solo lanza esa CLI como proceso.
 */

export const MODELOS: Record<CliId, { id: string; nombre: string }[]> = {
  claude: [
    { id: 'claude-opus-5-5', nombre: 'Opus 5.5' },
    { id: 'claude-sonnet-5-5', nombre: 'Sonnet 5.5' },
    { id: 'claude-haiku-5-5', nombre: 'Haiku 5.5' },
  ],
  codex: [],
};

export const ESFUERZOS: Esfuerzo[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Codex solo distingue hasta "high". */
const esfuerzoCodex = (e: Esfuerzo): string => (e === 'xhigh' || e === 'max' ? 'high' : e);

export interface EjecucionSpec {
  asignado: ModeloAsignado;
  /** Instrucciones fijas del rol; van en el prompt de sistema para que el caché las reutilice. */
  sistema?: string;
  /** Lo variable: recordatorio del hilo + contexto + la petición. */
  prompt: string;
  cwd: string;
  /** "plan" no modifica archivos. */
  soloLectura?: boolean;
  /** El agente puede editar archivos y correr solo las herramientas permitidas. Nunca publica: sin push ni borrados. */
  escritura?: boolean;
  /** Tope de gasto de un paso en dólares (solo Claude Code). */
  presupuestoUsd?: number;
  /** Paso suelto: no deja sesión guardada. */
  sinSesion?: boolean;
  /** Conversación continuada: la primera vez crea la sesión y las siguientes la reanudan, sin reenviar el historial. */
  sesion?: { id: string; reanudar: boolean };
  /** Recibe el texto mientras se escribe. */
  alTexto?: (delta: string) => void;
}

/** Lo único que un agente de escritura puede ejecutar: leer, editar, probar y guardar commits locales. */
export const HERRAMIENTAS_ESCRITURA = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git log:*)', 'Bash(mvn:*)', 'Bash(npm:*)', 'Bash(npx:*)'];
/** Lo que jamás puede hacer sin una persona: publicar, borrar o salir a la red. */
export const HERRAMIENTAS_PROHIBIDAS = ['Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git clean:*)', 'Bash(git checkout:*)', 'Bash(rm:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(gh:*)', 'Bash(sudo:*)'];

export function argumentosClaude(s: EjecucionSpec): string[] {
  return [
    '-p',
    '--model',
    s.asignado.modelo,
    '--effort',
    s.asignado.esfuerzo,
    '--output-format',
    'stream-json',
    '--verbose',
    ...(s.sistema ? ['--append-system-prompt', s.sistema] : []),
    ...(s.soloLectura ? ['--permission-mode', 'plan'] : []),
    ...(!s.soloLectura && s.escritura ? ['--permission-mode', 'acceptEdits', '--allowedTools', ...HERRAMIENTAS_ESCRITURA, '--disallowedTools', ...HERRAMIENTAS_PROHIBIDAS] : []),
    ...(s.presupuestoUsd ? ['--max-budget-usd', String(s.presupuestoUsd)] : []),
    ...(s.sinSesion && !s.sesion ? ['--no-session-persistence'] : []),
    ...(s.sesion ? (s.sesion.reanudar ? ['--resume', s.sesion.id] : ['--session-id', s.sesion.id]) : []),
    ...(s.alTexto ? ['--include-partial-messages'] : []),
  ];
}

export function argumentosCodex(s: EjecucionSpec): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    ...(s.asignado.modelo ? ['--model', s.asignado.modelo] : []),
    '-c',
    `model_reasoning_effort="${esfuerzoCodex(s.asignado.esfuerzo)}"`,
    ...(s.soloLectura ? ['--sandbox', 'read-only'] : s.escritura ? ['--sandbox', 'workspace-write'] : []),
    '-',
  ];
}

export interface EstadoSesion {
  cli: CliId;
  instalado: boolean;
  conectado: boolean;
  detalle: string;
}

async function probar(cmd: string, args: string[]): Promise<{ ok: boolean; salida: string }> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 15_000 });
    return { ok: true, salida: `${stdout}${stderr}`.trim() };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return { ok: false, salida: err.code === 'ENOENT' ? 'ENOENT' : `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() };
  }
}

export async function estadoSesion(cli: CliId): Promise<EstadoSesion> {
  if (cli === 'claude') {
    const r = await probar('claude', ['auth', 'status']);
    if (r.salida === 'ENOENT') return { cli, instalado: false, conectado: false, detalle: 'Claude Code no está instalado.' };
    try {
      const j = JSON.parse(r.salida) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string; email?: string };
      return {
        cli,
        instalado: true,
        conectado: Boolean(j.loggedIn),
        detalle: j.loggedIn ? `${j.email ?? 'sesión activa'} · plan ${j.subscriptionType ?? '?'} · ${j.authMethod ?? ''}` : 'Sin sesión.',
      };
    } catch {
      return { cli, instalado: true, conectado: false, detalle: r.salida || 'Sin sesión.' };
    }
  }
  const r = await probar('codex', ['login', 'status']);
  if (r.salida === 'ENOENT') return { cli, instalado: false, conectado: false, detalle: 'Codex no está instalado.' };
  return { cli, instalado: true, conectado: r.ok && !/not logged in/i.test(r.salida), detalle: r.salida || 'Sin sesión.' };
}

/** Abre el inicio de sesión de la suscripción en el navegador. No recibe ni guarda credenciales. */
export function iniciarSesion(cli: CliId, claudeConsola = false): Promise<void> {
  const [cmd, args] = cli === 'claude' ? (['claude', ['auth', 'login', claudeConsola ? '--console' : '--claudeai']] as const) : (['codex', ['login']] as const);
  return new Promise((resolver, rechazar) => {
    const p = spawn(cmd, [...args], { stdio: 'inherit' });
    p.on('error', rechazar);
    p.on('close', (c) => (c === 0 ? resolver() : rechazar(new Error(`${cmd} login terminó con código ${c}`))));
  });
}

export interface Resultado {
  texto: string;
  codigoSalida: number;
  duracionMs: number;
  eventos: number;
  /** Lo que la propia CLI informó haber gastado en este paso. */
  uso?: UsoAgente;
}

/** Texto final de una línea de salida JSON de Claude Code o Codex, si la línea lo trae. */
export function textoDeEvento(cli: CliId, linea: string): string | undefined {
  try {
    const e = JSON.parse(linea) as Record<string, unknown>;
    if (cli === 'claude') return e.type === 'result' && typeof e.result === 'string' ? e.result : undefined;
    const msg = (e.msg ?? e.item) as Record<string, unknown> | undefined;
    if (msg && (msg.type === 'agent_message' || msg.type === 'assistant_message') && typeof msg.text === 'string') return msg.text;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Fragmento de texto de un evento de flujo parcial (Claude Code: content_block_delta). */
export function deltaDeEvento(cli: CliId, linea: string): string | undefined {
  if (cli !== 'claude') return undefined;
  try {
    const e = JSON.parse(linea) as { type?: string; event?: { type?: string; delta?: { text?: string } } };
    return e.type === 'stream_event' && e.event?.type === 'content_block_delta' ? e.event.delta?.text : undefined;
  } catch {
    return undefined;
  }
}

export function ejecutar(s: EjecucionSpec, alEvento?: (linea: string) => void): Promise<Resultado> {
  const cli = s.asignado.cli;
  const args = cli === 'claude' ? argumentosClaude(s) : argumentosCodex(s);
  const inicio = Date.now();
  return new Promise((resolver, rechazar) => {
    const p = spawn(cli, args, { cwd: s.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let restos = '';
    let texto = '';
    let eventos = 0;
    let uso: UsoAgente | undefined;
    p.stdout.on('data', (d: Buffer) => {
      restos += d.toString('utf8');
      const lineas = restos.split('\n');
      restos = lineas.pop() ?? '';
      for (const l of lineas) {
        if (!l.trim()) continue;
        eventos++;
        alEvento?.(l);
        if (s.alTexto) {
          const d = deltaDeEvento(cli, l);
          if (d) s.alTexto(d);
        }
        texto = textoDeEvento(cli, l) ?? texto;
        uso = usoDeLinea(cli, l) ?? uso;
      }
    });
    p.on('error', rechazar);
    p.on('close', (c) => resolver({ texto, codigoSalida: c ?? 1, duracionMs: Date.now() - inicio, eventos, ...(uso ? { uso } : {}) }));
    p.stdin.end(s.prompt);
  });
}

// ---------- Orquestador y subagentes ----------

export interface Subtarea {
  rol: RolId;
  instruccion: string;
  /** Consulta para armar el contexto de este subagente, no el de todo el proyecto. */
  consulta: string;
}

const ROL_A_MODELO: Record<RolId, keyof Perfil['modelos']> = {
  desarrollador: 'desarrollo',
  documentador: 'documentacion',
  tester: 'testing',
  integrador: 'integracion',
};

export const modeloDeRol = (p: Perfil, rol: RolId): ModeloAsignado => p.modelos[ROL_A_MODELO[rol]];

/** El orquestador solo planifica: devuelve JSON con subtareas. No toca archivos. */
export const promptOrquestador = (objetivo: string, recordatorio: string): string =>
  `${recordatorio}\n\nObjetivo: ${objetivo}\n\nDivide el objetivo en subtareas independientes y pequeñas. ` +
  `Responde SOLO con un arreglo JSON de objetos {"rol":"desarrollador|documentador|tester|integrador","instruccion":"...","consulta":"palabras para buscar contexto"}. ` +
  `Máximo 6 subtareas. No inventes datos: si falta información, crea una subtarea de tipo "documentador" que la pregunte.`;

export function leerSubtareas(texto: string): Subtarea[] {
  const m = /\[[\s\S]*\]/.exec(texto);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as Partial<Subtarea>[];
    const roles: RolId[] = ['desarrollador', 'documentador', 'tester', 'integrador'];
    return arr
      .filter((s): s is Subtarea => Boolean(s.rol && roles.includes(s.rol) && s.instruccion && s.consulta))
      .slice(0, 6);
  } catch {
    return [];
  }
}

/** Corre las subtareas con un tope de paralelismo; cada una usa el modelo asignado a su rol. */
export async function correrSubagentes<T>(items: T[], limite: number, tarea: (x: T) => Promise<unknown>): Promise<void> {
  const cola = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limite, cola.length) }, async () => {
      for (let x = cola.shift(); x !== undefined; x = cola.shift()) await tarea(x);
    }),
  );
}
