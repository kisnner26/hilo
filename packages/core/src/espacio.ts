import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { comprimirSalida } from './ahorro.js';

const exec = promisify(execFile);

/**
 * Espacio de trabajo aislado: cada tarea se hace en su propia copia (git worktree) y en su propia rama,
 * para que el agente pueda editar y probar sin tocar lo que la persona tiene abierto en su carpeta.
 */

const git = async (cwd: string, args: string[], timeout = 120_000): Promise<string> => {
  const { stdout } = await exec('git', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
};

const sinBarras = (rama: string): string => rama.replace(/[^A-Za-z0-9._-]+/g, '__');

export interface Espacio {
  dir: string;
  rama: string;
  base: string;
  /** Ya existía de una corrida anterior: se retoma, no se reinicia. */
  reutilizado: boolean;
}

export async function crearEspacio(proyecto: string, rama: string, base: string, carpetaTrabajo: string): Promise<Espacio> {
  if (!/^[A-Za-z0-9._/-]+$/.test(rama) || rama.startsWith('-')) throw new Error(`Nombre de rama no válido: ${rama}`);
  mkdirSync(carpetaTrabajo, { recursive: true });
  const dir = join(carpetaTrabajo, sinBarras(rama));
  if (existsSync(join(dir, '.git'))) return { dir, rama, base, reutilizado: true };
  await git(proyecto, ['fetch', 'origin', base]).catch(() => '');
  const origen = await git(proyecto, ['rev-parse', '--verify', '--quiet', `origin/${base}`]).then(() => `origin/${base}`, () => base);
  const existe = await git(proyecto, ['rev-parse', '--verify', '--quiet', `refs/heads/${rama}`]).then(() => true, () => false);
  await git(proyecto, existe ? ['worktree', 'add', dir, rama] : ['worktree', 'add', '-b', rama, dir, origen]);
  return { dir, rama, base, reutilizado: existe };
}

export interface CambiosEspacio {
  archivos: string[];
  lineas: number;
  commits: number;
  /** Quedó algo sin guardar en un commit. */
  sinGuardar: boolean;
  resumen: string;
}

export async function cambiosDelEspacio(e: Pick<Espacio, 'dir' | 'base'>): Promise<CambiosEspacio> {
  const ref = await git(e.dir, ['rev-parse', '--verify', '--quiet', `origin/${e.base}`]).then(() => `origin/${e.base}`, () => e.base);
  const numstat = await git(e.dir, ['diff', '--numstat', `${ref}...HEAD`]);
  const archivos: string[] = [];
  let lineas = 0;
  for (const l of numstat.split('\n').filter(Boolean)) {
    const [a, b, ...ruta] = l.split('\t');
    archivos.push(ruta.join('\t'));
    lineas += (Number(a) || 0) + (Number(b) || 0);
  }
  const commits = Number(await git(e.dir, ['rev-list', '--count', `${ref}..HEAD`]));
  const sinGuardar = (await git(e.dir, ['status', '--porcelain'])).length > 0;
  return { archivos, lineas, commits, sinGuardar, resumen: `${archivos.length} archivo(s), ${lineas} líneas, ${commits} commit(s)${sinGuardar ? ', con cambios sin guardar' : ''}` };
}

export interface ResultadoVerificacion {
  comando: string;
  ok: boolean;
  salida: string;
}

/** Corre las comprobaciones del proyecto sin pasar por el modelo; solo lo que falla vuelve, comprimido. */
export async function correrVerificaciones(dir: string, comandos: string[], timeoutMs = 600_000): Promise<{ ok: boolean; resultados: ResultadoVerificacion[] }> {
  const resultados: ResultadoVerificacion[] = [];
  for (const comando of comandos) {
    try {
      const { stdout, stderr } = await exec('sh', ['-c', comando], { cwd: dir, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
      resultados.push({ comando, ok: true, salida: comprimirSalida(`${stdout}\n${stderr}`, 12) });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      resultados.push({ comando, ok: false, salida: comprimirSalida(`${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim() || (err.message ?? 'falló'), 50) });
      break;
    }
  }
  return { ok: resultados.every((r) => r.ok), resultados };
}

/** Comandos de verificación que corresponden a los archivos tocados. */
export function verificacionesPara(archivos: string[], v: { backend: string[]; frontend: string[] }): string[] {
  return [...(archivos.some((a) => a.startsWith('backend/')) ? v.backend : []), ...(archivos.some((a) => a.startsWith('frontend/')) ? v.frontend : [])];
}

/** Dueño del remoto `origin`: sirve para abrir el PR desde una bifurcación como "dueño:rama". */
export async function duenoDeOrigin(proyecto: string): Promise<string | undefined> {
  const url = await git(proyecto, ['remote', 'get-url', 'origin']).catch(() => '');
  return /github\.com[:/]([^/]+)\//.exec(url)?.[1];
}

/** Sube la rama a `origin`. Solo se llama después de que una persona aprobó publicarla. */
export async function empujarRama(dir: string, rama: string): Promise<void> {
  await git(dir, ['push', '-u', 'origin', rama], 180_000);
}

/** Quita un espacio creado por Hilo. Se niega a tocar nada fuera de la carpeta de trabajo. */
export async function quitarEspacio(proyecto: string, dir: string, carpetaTrabajo: string): Promise<void> {
  const d = resolve(dir);
  if (!d.startsWith(resolve(carpetaTrabajo) + sep)) throw new Error('Ese espacio no lo creó Hilo.');
  await git(proyecto, ['worktree', 'remove', '--force', d]);
}
