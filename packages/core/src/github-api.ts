import type { PrEnCola } from './balance.js';
import { estadoCi, type PrResumen } from './midia.js';
import type { Cambio } from './rules.js';

type Respuesta = { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string>; headers?: { get(n: string): string | null } };
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Respuesta>;

const BASE = 'https://api.github.com';

const CONSULTA_PRS = `query($o:String!,$r:String!,$despues:String){repository(owner:$o,name:$r){pullRequests(states:OPEN,first:50,after:$despues,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{number title url isDraft headRefName mergeStateStatus reviewDecision additions deletions author{login} reviewRequests(first:20){nodes{requestedReviewer{... on User{login}}}} comments(first:100){nodes{author{login}}} reviews(first:100){nodes{author{login}}} commits(last:1){nodes{commit{statusCheckRollup{contexts(first:60){nodes{__typename ... on CheckRun{name conclusion status} ... on StatusContext{context state}}}}}}}}}}}`;

interface NodoPr {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  author: { login: string } | null;
  reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] };
  comments: { nodes: { author: { login: string } | null }[] };
  reviews: { nodes: { author: { login: string } | null }[] };
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: Record<string, string | undefined>[] } } | null } }[] };
}

export class ErrorGithub extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/**
 * Cliente de GitHub por API con un token personal. No depende de `gh`: el token puede venir de `gh auth token`
 * o pegado por la persona. Una sola consulta GraphQL trae PR, CI, revisiones y comentarios.
 */
export class GitHubApi {
  private cachePrs = new Map<string, { hasta: number; datos: NodoPr[] }>();

  constructor(
    private token: string,
    private fetchFn: Fetch = fetch as unknown as Fetch,
    private base = BASE,
    private ahora: () => number = Date.now,
  ) {}

  private async pedir<T>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const r = await this.fetchFn(`${this.base}${ruta}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'hilo' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (r.status === 401) throw new ErrorGithub(401, 'GitHub rechazó el token (401): venció o se revocó. Conéctalo de nuevo.');
    if (r.status === 403) {
      const resto = r.headers?.get('x-ratelimit-remaining');
      throw new ErrorGithub(403, resto === '0' ? 'GitHub limitó las peticiones (403). Espera unos minutos.' : 'GitHub negó el acceso (403): el token no tiene permiso para esto, o la organización exige autorizarlo (SSO).');
    }
    if (r.status === 404) throw new ErrorGithub(404, 'No encontrado (404): revisa el nombre del repositorio y que tu cuenta tenga acceso.');
    if (!r.ok) throw new ErrorGithub(r.status, `GitHub respondió ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return (await r.json()) as T;
  }

  async yo(): Promise<{ login: string; nombre: string }> {
    const u = await this.pedir<{ login: string; name: string | null }>('/user');
    return { login: u.login, nombre: u.name ?? '' };
  }

  async repoValido(repo: string): Promise<boolean> {
    try {
      await this.pedir(`/repos/${repo}`);
      return true;
    } catch (e) {
      if (e instanceof ErrorGithub && e.estado === 404) return false;
      throw e;
    }
  }

  async limite(): Promise<{ restante: number; total: number }> {
    const r = await this.pedir<{ resources: { core: { remaining: number; limit: number } } }>('/rate_limit');
    return { restante: r.resources.core.remaining, total: r.resources.core.limit };
  }

  private async nodosPr(repo: string): Promise<NodoPr[]> {
    const clave = repo;
    const c = this.cachePrs.get(clave);
    if (c && c.hasta > this.ahora()) return c.datos;
    const [dueno, nombre] = repo.split('/');
    const todos: NodoPr[] = [];
    let despues: string | null = null;
    for (let i = 0; i < 6; i++) {
      const r: { data?: { repository?: { pullRequests: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: NodoPr[] } } }; errors?: { message: string }[] } = await this.pedir('/graphql', { method: 'POST', body: { query: CONSULTA_PRS, variables: { o: dueno, r: nombre, despues } } });
      if (r.errors?.length) throw new ErrorGithub(400, `GitHub: ${r.errors[0]!.message}`);
      const pagina = r.data?.repository?.pullRequests;
      if (!pagina) throw new ErrorGithub(404, 'No encontrado (404): revisa el nombre del repositorio y que tu cuenta tenga acceso.');
      todos.push(...pagina.nodes);
      if (!pagina.pageInfo.hasNextPage) break;
      despues = pagina.pageInfo.endCursor;
    }
    this.cachePrs.set(clave, { hasta: this.ahora() + 20_000, datos: todos });
    return todos;
  }

  async prsAbiertos(repo: string, yo?: string): Promise<PrResumen[]> {
    return (await this.nodosPr(repo)).map((p) => {
      const checks = (p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map((c) =>
        c.__typename === 'StatusContext'
          ? { name: c.context ?? '', conclusion: c.state === 'SUCCESS' ? 'SUCCESS' : c.state === 'PENDING' ? null : 'FAILURE', status: c.state === 'PENDING' ? 'PENDING' : 'COMPLETED' }
          : { name: c.name ?? '', conclusion: c.conclusion ?? null, status: c.status },
      );
      return {
        numero: p.number,
        titulo: p.title,
        autor: p.author?.login ?? 'desconocido',
        rama: p.headRefName,
        borrador: p.isDraft,
        url: p.url,
        ci: estadoCi(checks as { name: string; conclusion?: string | null; status?: string }[]),
        revision: p.reviewDecision === 'APPROVED' ? 'aprobado' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'cambios' : p.reviewDecision === 'REVIEW_REQUIRED' ? 'requerida' : 'ninguna',
        estadoFusion: p.mergeStateStatus,
        pidenMiRevision: Boolean(yo && p.reviewRequests.nodes.some((n) => n.requestedReviewer?.login === yo)),
      } satisfies PrResumen;
    });
  }

  /** `rondas` es una aproximación: comentarios y revisiones de integradores en ese PR. */
  async cola(repo: string, integradores: string[]): Promise<PrEnCola[]> {
    return (await this.nodosPr(repo)).map((p) => ({
      numero: p.number,
      autor: p.author?.login ?? 'desconocido',
      rondas: [...p.comments.nodes, ...p.reviews.nodes].filter((n) => n.author && integradores.includes(n.author.login)).length,
      lineas: p.additions + p.deletions,
      listo: !p.isDraft,
    }));
  }

  async cambioDePr(repo: string, numero: number | string): Promise<Cambio> {
    const meta = await this.pedir<{ title: string; body: string | null; head: { ref: string }; labels: { name: string }[] }>(`/repos/${repo}/pulls/${numero}`);
    const archivos: Cambio['archivos'] = [];
    for (let pagina = 1; pagina <= 10; pagina++) {
      const fs = await this.pedir<{ filename: string; status: string; additions: number; deletions: number }[]>(`/repos/${repo}/pulls/${numero}/files?per_page=100&page=${pagina}`);
      for (const f of fs) archivos.push({ ruta: f.filename, estado: f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M', adiciones: f.additions, eliminaciones: f.deletions });
      if (fs.length < 100) break;
    }
    return { rama: meta.head.ref, titulo: meta.title, cuerpo: meta.body ?? '', archivos, etiquetas: meta.labels.map((l) => l.name) };
  }

  /** Diff del PR recortado a `maxLineas`, para que el asistente lo revise sin gastar de más. */
  async diff(repo: string, numero: number | string, maxLineas = 300): Promise<string> {
    const r = await this.fetchFn(`${this.base}/repos/${repo}/pulls/${numero}`, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github.v3.diff', 'User-Agent': 'hilo' } });
    if (!r.ok) throw new ErrorGithub(r.status, `GitHub respondió ${r.status} al pedir el diff.`);
    const lineas = (await r.text()).split('\n');
    return lineas.length <= maxLineas ? lineas.join('\n') : `${lineas.slice(0, maxLineas).join('\n')}\n[... ${lineas.length - maxLineas} líneas más ...]`;
  }

  /** Publica un comentario. Quien llama debe haber obtenido antes la aprobación de una persona. */
  async comentar(repo: string, numero: number | string, texto: string): Promise<string> {
    const r = await this.pedir<{ html_url: string }>(`/repos/${repo}/issues/${numero}/comments`, { method: 'POST', body: { body: texto } });
    return r.html_url;
  }

  async releases(repo: string): Promise<{ tag: string; publicado: string; activos: { nombre: string; descargas: number }[] }[]> {
    const r = await this.pedir<{ tag_name: string; published_at: string; assets: { name: string; download_count: number }[] }[]>(`/repos/${repo}/releases?per_page=30`);
    return r.map((x) => ({ tag: x.tag_name, publicado: x.published_at, activos: x.assets.map((a) => ({ nombre: a.name, descargas: a.download_count })) }));
  }
}

/** Releases de un repositorio público sin token (para contar descargas aunque la persona no haya conectado GitHub). */
export async function publicoReleases(repo: string, fetchFn: Fetch = fetch as unknown as Fetch): Promise<{ tag: string; publicado: string; activos: { nombre: string; descargas: number }[] }[]> {
  const r = await fetchFn(`${BASE}/repos/${repo}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hilo' } });
  if (r.status === 404) return [];
  if (!r.ok) throw new ErrorGithub(r.status, `GitHub respondió ${r.status}.`);
  const j = (await r.json()) as { tag_name: string; published_at: string; assets: { name: string; download_count: number }[] }[];
  return j.map((x) => ({ tag: x.tag_name, publicado: x.published_at, activos: x.assets.map((a) => ({ nombre: a.name, descargas: a.download_count })) }));
}
