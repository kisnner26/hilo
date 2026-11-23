import { describe, expect, it } from 'vitest';
import { delimiter, join } from 'node:path';
import { GitHubApi, ErrorGithub, ampliarPath, buscar, directoriosComunes, errorLegible, mensajeFaltante, prepararPath } from '../src/index.js';

type Llamada = { url: string; metodo: string; auth?: string; cuerpo?: unknown };
function falso(rutas: Record<string, unknown>, estado = 200, cabeceras: Record<string, string> = {}) {
  const llamadas: Llamada[] = [];
  const f = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    llamadas.push({ url, metodo: init?.method ?? 'GET', auth: init?.headers?.Authorization, cuerpo: init?.body ? JSON.parse(init.body) : undefined });
    const k = Object.keys(rutas).find((x) => url.includes(x));
    return { ok: estado < 400, status: estado, json: async () => (k ? rutas[k] : {}), text: async () => 'detalle', headers: { get: (n: string) => cabeceras[n.toLowerCase()] ?? null } };
  };
  return { f, llamadas };
}

const nodo = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `[GEN-0${n}-BE] x`,
  url: `https://github.com/o/r/pull/${n}`,
  isDraft: false,
  headRefName: 'feature/a-GEN-01-BE',
  mergeStateStatus: 'BLOCKED',
  reviewDecision: 'REVIEW_REQUIRED',
  additions: 100,
  deletions: 20,
  author: { login: 'ana' },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'kisnner26' } }] },
  comments: { nodes: [{ author: { login: 'kisnner26' } }, { author: { login: 'ana' } }] },
  reviews: { nodes: [{ author: { login: 'kisnner26' } }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'reglas', conclusion: 'SUCCESS', status: 'COMPLETED' }, { __typename: 'CheckRun', name: 'backend-build', conclusion: 'FAILURE', status: 'COMPLETED' }, { __typename: 'CheckRun', name: 'testing-ok', conclusion: 'FAILURE', status: 'COMPLETED' }] } } } }] },
  ...extra,
});

describe('GitHub por API', () => {
  it('envía el token solo en la cabecera y lee el usuario', async () => {
    const { f, llamadas } = falso({ '/user': { login: 'kisnner26', name: 'Kisnner Obando' } });
    expect(await new GitHubApi('ghp_secreto', f).yo()).toEqual({ login: 'kisnner26', nombre: 'Kisnner Obando' });
    expect(llamadas[0]?.auth).toBe('Bearer ghp_secreto');
    expect(llamadas[0]?.url).not.toContain('ghp_secreto');
  });

  it('una sola consulta trae PR, CI, revisión pedida y rondas de integradores', async () => {
    const { f, llamadas } = falso({ '/graphql': { data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: '' }, nodes: [nodo(1), nodo(2, { isDraft: true, reviewDecision: 'APPROVED' })] } } } } });
    const api = new GitHubApi('t', f);
    const prs = await api.prsAbiertos('o/r', 'kisnner26');
    expect(prs[0]).toMatchObject({ numero: 1, autor: 'ana', ci: 'fallo', revision: 'requerida', pidenMiRevision: true, borrador: false });
    expect(prs[1]).toMatchObject({ borrador: true, revision: 'aprobado' });
    const cola = await api.cola('o/r', ['kisnner26', 'over2099']);
    expect(cola[0]).toMatchObject({ numero: 1, rondas: 2, lineas: 120, listo: true });
    expect(llamadas.filter((l) => l.url.endsWith('/graphql'))).toHaveLength(1); // el segundo uso sale de la caché
  });

  it('pagina cuando hay más de 50 PR', async () => {
    let paso = 0;
    const f = async () => ({ ok: true, status: 200, json: async () => ({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: paso++ === 0, endCursor: 'c1' }, nodes: [nodo(paso)] } } } }), text: async () => '' });
    expect((await new GitHubApi('t', f as never).prsAbiertos('o/r')).length).toBe(2);
  });

  it('arma el cambio de un PR con estados de archivo y etiquetas', async () => {
    const { f } = falso({
      '/pulls/9/files': [{ filename: 'a.md', status: 'added', additions: 3, deletions: 0 }, { filename: 'b.ts', status: 'modified', additions: 1, deletions: 1 }],
      '/pulls/9': { title: '[X-1] t', body: null, head: { ref: 'feature/a-X-1' }, labels: [{ name: 'testing-ok' }] },
    });
    const c = await new GitHubApi('t', f).cambioDePr('o/r', 9);
    expect(c).toMatchObject({ rama: 'feature/a-X-1', cuerpo: '', etiquetas: ['testing-ok'] });
    expect(c.archivos.map((a) => a.estado)).toEqual(['A', 'M']);
  });

  it('publica un comentario con el texto exacto', async () => {
    const { f, llamadas } = falso({ '/comments': { html_url: 'https://github.com/o/r/pull/9#c1' } });
    expect(await new GitHubApi('t', f).comentar('o/r', 9, 'hola')).toBe('https://github.com/o/r/pull/9#c1');
    expect(llamadas[0]).toMatchObject({ metodo: 'POST', cuerpo: { body: 'hola' } });
  });

  it('distingue repositorio inexistente, token vencido, límite y falta de permiso', async () => {
    expect(await new GitHubApi('t', falso({}, 404).f).repoValido('x/y')).toBe(false);
    await expect(new GitHubApi('t', falso({}, 401).f).yo()).rejects.toThrow(/venció/);
    await expect(new GitHubApi('t', falso({}, 403, { 'x-ratelimit-remaining': '0' }).f).yo()).rejects.toThrow(/limitó/);
    await expect(new GitHubApi('t', falso({}, 403).f).yo()).rejects.toThrow(/SSO/);
    await expect(new GitHubApi('t', falso({}, 500).f).yo()).rejects.toBeInstanceOf(ErrorGithub);
  });

  it('cuenta descargas de los releases', async () => {
    const { f } = falso({ '/releases': [{ tag_name: 'v0.1.0', published_at: '2026-11-23T00:00:00Z', assets: [{ name: 'a.dmg', download_count: 3 }] }] });
    expect((await new GitHubApi('t', f).releases('o/r'))[0]?.activos[0]).toEqual({ nombre: 'a.dmg', descargas: 3 });
  });
});

describe('entorno de la app', () => {
  it('conoce las carpetas de Homebrew y de las instalaciones por usuario', () => {
    const d = directoriosComunes('darwin', '/Users/x');
    expect(d).toContain('/opt/homebrew/bin');
    expect(d).toContain(join('/Users/x', '.local', 'bin'));
    expect(directoriosComunes('win32', 'C:\\Users\\x').some((p) => /GitHub CLI/.test(p))).toBe(true);
  });

  it('reconstruye un PATH vacío (como al abrir desde el Dock) sin repetidos', () => {
    const antes = process.env.PATH;
    process.env.PATH = '/usr/bin';
    const nuevo = prepararPath().split(delimiter);
    process.env.PATH = antes;
    expect(nuevo).toContain(directoriosComunes()[0]);
    expect(new Set(nuevo).size).toBe(nuevo.length);
  });

  it('amplía el PATH con el del shell sin perder lo anterior', async () => {
    const antes = process.env.PATH;
    process.env.PATH = '/usr/bin';
    const nuevo = (await ampliarPath()).split(delimiter);
    process.env.PATH = antes;
    expect(nuevo[0]).toBe('/usr/bin');
    expect(new Set(nuevo).size).toBe(nuevo.length);
  }, 15000);

  it('encuentra una herramienta instalada y devuelve undefined si no está', () => {
    expect(buscar('node', process.env.PATH)).toBeTruthy();
    expect(buscar('programa-que-no-existe-hilo')).toBeUndefined();
  });

  it('traduce ENOENT a cómo instalar la herramienta', () => {
    expect(errorLegible(new Error('spawn gh ENOENT'), 'gh')).toMatch(/brew install gh/);
    expect(mensajeFaltante('claude')).toMatch(/Claude Code/);
    expect(errorLegible(new Error("Error invoking remote method 'x': Error: algo falló"))).toBe('algo falló');
  });
});
