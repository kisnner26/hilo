import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

export type Herramienta = 'gh' | 'claude' | 'codex' | 'git';

/** Carpetas donde suelen vivir las herramientas y que una app abierta desde el Dock o el menú no hereda. */
export function directoriosComunes(plataforma = process.platform, casa = homedir()): string[] {
  if (plataforma === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(casa, 'AppData', 'Local');
    const datos = process.env.APPDATA ?? join(casa, 'AppData', 'Roaming');
    return [join(datos, 'npm'), 'C:\\Program Files\\GitHub CLI', join(local, 'Programs', 'GitHub CLI'), join(local, 'Microsoft', 'WinGet', 'Links'), join(casa, '.claude', 'local')];
  }
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    join(casa, '.local', 'bin'),
    join(casa, '.claude', 'local'),
    join(casa, '.npm-global', 'bin'),
    join(casa, '.volta', 'bin'),
    join(casa, '.bun', 'bin'),
    join(casa, 'bin'),
    '/home/linuxbrew/.linuxbrew/bin',
    '/snap/bin',
  ];
}

/** PATH del shell de inicio de sesión: es el que ve la terminal y el que una app gráfica no recibe. Tarda unos segundos. */
async function pathDelShell(): Promise<string[]> {
  if (process.platform === 'win32') return [];
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  try {
    const { stdout } = await ejecutar(shell, ['-ilc', 'printf "__HILO__%s__HILO__" "$PATH"'], { encoding: 'utf8', timeout: 8000 });
    const m = /__HILO__(.*?)__HILO__/s.exec(stdout);
    return m?.[1] ? m[1].split(delimiter).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const unir = (...listas: string[][]): string => [...new Set(listas.flat())].join(delimiter);

/** Al instante: agrega al PATH las carpetas comunes (Homebrew, instalaciones por usuario). Resuelve el caso de abrir desde el Dock. */
export function prepararPath(): string {
  process.env.PATH = unir((process.env.PATH ?? '').split(delimiter).filter(Boolean), directoriosComunes());
  return process.env.PATH;
}

/** En segundo plano: suma el PATH real del shell de la persona (nvm, volta, rutas propias). */
export async function ampliarPath(): Promise<string> {
  const delShell = await pathDelShell();
  process.env.PATH = unir((process.env.PATH ?? '').split(delimiter).filter(Boolean), delShell);
  return process.env.PATH;
}

function esEjecutable(ruta: string): boolean {
  try {
    accessSync(ruta, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Ruta absoluta de una herramienta según el PATH actual, o undefined si no está instalada. */
export function buscar(nombre: Herramienta | string, path = process.env.PATH ?? ''): string | undefined {
  const extensiones = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const ext of extensiones) {
      const ruta = join(dir, `${nombre}${ext}`);
      if (esEjecutable(ruta)) return ruta;
    }
  }
  return undefined;
}

export const AYUDA_INSTALACION: Record<Herramienta, { nombre: string; instalar: string; url: string }> = {
  gh: { nombre: 'GitHub CLI', instalar: 'macOS: brew install gh · Windows: winget install GitHub.cli', url: 'https://cli.github.com' },
  claude: { nombre: 'Claude Code', instalar: 'npm install -g @anthropic-ai/claude-code, o el instalador de la página', url: 'https://claude.com/claude-code' },
  codex: { nombre: 'Codex', instalar: 'npm install -g @openai/codex', url: 'https://github.com/openai/codex' },
  git: { nombre: 'Git', instalar: 'macOS: xcode-select --install · Windows: winget install Git.Git', url: 'https://git-scm.com' },
};

/** Mensaje claro cuando falta una herramienta, con cómo instalarla. */
export function mensajeFaltante(h: Herramienta): string {
  const a = AYUDA_INSTALACION[h];
  return `${a.nombre} no está instalado o no se encuentra. ${a.instalar}. Más información: ${a.url}`;
}

/** Convierte un error técnico de proceso en algo que una persona entienda. */
export function errorLegible(e: unknown, h?: Herramienta): string {
  const t = e instanceof Error ? e.message : String(e);
  if (/ENOENT/.test(t)) return h ? mensajeFaltante(h) : 'No se encontró un programa necesario.';
  return t.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
