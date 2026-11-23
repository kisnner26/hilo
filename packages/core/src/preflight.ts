import { execFileSync } from 'node:child_process';
import type { Perfil } from './profile.js';
import { validarTodo, type ArchivoCambiado, type Cambio, type Hallazgo } from './rules.js';

export interface Informe {
  ok: boolean;
  errores: Hallazgo[];
  avisos: Hallazgo[];
  /** Comandos que el autor debe correr y pegar en "Validaciones". Hilo no los corre por él. */
  verificaciones: string[];
  lineas: number;
}

export function informe(c: Cambio, p: Perfil): Informe {
  const hallazgos = validarTodo(c, p);
  const errores = hallazgos.filter((h) => h.gravedad === 'error');
  const avisos = hallazgos.filter((h) => h.gravedad === 'aviso');
  const toca = (prefijo: string) => c.archivos.some((a) => a.ruta.startsWith(prefijo));
  return {
    ok: errores.length === 0,
    errores,
    avisos,
    lineas: c.archivos.reduce((n, a) => n + a.adiciones + a.eliminaciones, 0),
    verificaciones: [
      ...(toca('backend/') ? p.verificaciones.backend : []),
      ...(toca('frontend/') ? p.verificaciones.frontend.map((x) => `(cd frontend && ${x})`) : []),
    ],
  };
}

export function formatearInforme(i: Informe): string {
  const lineas: string[] = [];
  lineas.push(i.ok ? `Listo para abrir el PR (${i.lineas} líneas).` : `No abras el PR todavía (${i.lineas} líneas).`);
  for (const h of i.errores) lineas.push(`  ERROR  [${h.regla}] ${h.mensaje}${h.arreglo ? `\n         -> ${h.arreglo}` : ''}`);
  for (const h of i.avisos) lineas.push(`  AVISO  [${h.regla}] ${h.mensaje}${h.arreglo ? `\n         -> ${h.arreglo}` : ''}`);
  if (i.verificaciones.length > 0) {
    lineas.push('Corre y pega el resultado en "Validaciones":');
    for (const v of i.verificaciones) lineas.push(`  ${v}`);
  }
  return lineas.join('\n');
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Arma el Cambio desde un repositorio local midiendo contra el merge-base con la base. */
export function cambioDesdeGit(cwd: string, perfil: Perfil, opciones: { titulo?: string; cuerpo?: string } = {}): Cambio {
  const base = `origin/${perfil.repo.base}`;
  const ancestro = git(cwd, 'merge-base', base, 'HEAD');
  const rama = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  const numstat = git(cwd, 'diff', '--numstat', '-M', `${ancestro}...HEAD`);
  const estados = new Map<string, ArchivoCambiado['estado']>();
  for (const l of git(cwd, 'diff', '--name-status', '-M', `${ancestro}...HEAD`).split('\n').filter(Boolean)) {
    const [e, ...rutas] = l.split('\t');
    const ruta = rutas[rutas.length - 1];
    if (e && ruta) estados.set(ruta, (e[0] as ArchivoCambiado['estado']) ?? 'M');
  }
  const archivos: ArchivoCambiado[] = numstat
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...r] = l.split('\t');
      const ruta = (r[r.length - 1] ?? '').replace(/.*=> (.*)}/, '$1');
      return {
        ruta,
        estado: estados.get(ruta) ?? 'M',
        adiciones: a === '-' ? 0 : Number(a),
        eliminaciones: d === '-' ? 0 : Number(d),
      };
    });
  const titulo = opciones.titulo ?? git(cwd, 'log', '-1', '--format=%s');
  return { rama, titulo, cuerpo: opciones.cuerpo ?? '', archivos };
}
