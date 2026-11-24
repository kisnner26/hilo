import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cambiosDelEspacio, correrVerificaciones, crearEspacio, quitarEspacio, verificacionesPara } from '../src/index.js';

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();

let proyecto: string;
let trabajo: string;

beforeAll(() => {
  if (process.platform === 'win32') return;
  const raiz = mkdtempSync(join(tmpdir(), 'hilo-espacio-'));
  proyecto = join(raiz, 'repo');
  trabajo = join(raiz, 'trabajo');
  mkdirSync(proyecto);
  g(proyecto, 'init', '-q', '-b', 'main');
  writeFileSync(join(proyecto, 'a.txt'), 'uno\n');
  g(proyecto, 'add', '.');
  g(proyecto, 'commit', '-q', '-m', 'base');
});

describe.runIf(process.platform !== 'win32')('espacio de trabajo aislado', () => {
  it('crea una rama y una copia aparte sin tocar la carpeta original', async () => {
    const e = await crearEspacio(proyecto, 'feature/ana-GEN-01-BE', 'main', trabajo);
    expect(e.reutilizado).toBe(false);
    expect(existsSync(join(e.dir, 'a.txt'))).toBe(true);
    expect(g(proyecto, 'branch', '--show-current')).toBe('main');
    expect(g(e.dir, 'branch', '--show-current')).toBe('feature/ana-GEN-01-BE');
  });

  it('retoma el espacio si ya existe en vez de reiniciarlo', async () => {
    const e = await crearEspacio(proyecto, 'feature/ana-GEN-01-BE', 'main', trabajo);
    expect(e.reutilizado).toBe(true);
  });

  it('cuenta archivos, líneas y commits frente a la base, y avisa de lo no guardado', async () => {
    const e = await crearEspacio(proyecto, 'feature/ana-GEN-01-BE', 'main', trabajo);
    writeFileSync(join(e.dir, 'b.txt'), 'x\ny\nz\n');
    g(e.dir, 'add', '.');
    g(e.dir, 'commit', '-q', '-m', 'agrega b');
    writeFileSync(join(e.dir, 'c.txt'), 'pendiente');
    const c = await cambiosDelEspacio(e);
    expect(c).toMatchObject({ archivos: ['b.txt'], lineas: 3, commits: 1, sinGuardar: true });
    expect(c.resumen).toContain('con cambios sin guardar');
  });

  it('rechaza nombres de rama que parecen opciones de git', async () => {
    await expect(crearEspacio(proyecto, '--upload-pack=x', 'main', trabajo)).rejects.toThrow('no válido');
  });

  it('no quita carpetas que no están dentro de la carpeta de trabajo', async () => {
    await expect(quitarEspacio(proyecto, proyecto, trabajo)).rejects.toThrow('no lo creó Hilo');
  });

  it('quita el espacio que sí creó', async () => {
    const e = await crearEspacio(proyecto, 'fix/ana-BUG-01', 'main', trabajo);
    await quitarEspacio(proyecto, e.dir, trabajo);
    expect(existsSync(e.dir)).toBe(false);
  });
});

describe.runIf(process.platform !== 'win32')('verificaciones sin modelo', () => {
  it('elige los comandos según lo que se tocó', () => {
    const v = { backend: ['mvn spotless:check'], frontend: ['npm test', 'npm run lint'] };
    expect(verificacionesPara(['backend/A.java'], v)).toEqual(['mvn spotless:check']);
    expect(verificacionesPara(['frontend/x.ts', 'backend/A.java'], v)).toEqual(['mvn spotless:check', 'npm test', 'npm run lint']);
    expect(verificacionesPara(['docs/x.md'], v)).toEqual([]);
  });

  it('se detiene en el primer fallo y devuelve su salida comprimida', async () => {
    const r = await correrVerificaciones(tmpdir(), ['echo bien', 'echo "[ERROR] algo se rompió" >&2; exit 3', 'echo nunca']);
    expect(r.ok).toBe(false);
    expect(r.resultados.map((x) => x.ok)).toEqual([true, false]);
    expect(r.resultados[1]!.salida).toContain('algo se rompió');
  });
});
