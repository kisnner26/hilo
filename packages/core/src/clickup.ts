import type { RolId } from './profile.js';
import type { TareaPlan } from './xp.js';

export interface TareaClickup {
  id: string;
  codigo: string;
  nombre: string;
  estado: string;
  lista: string;
  asignados: string[];
  vence?: string;
  /** ids de las tareas de las que esta depende */
  dependeDe: string[];
}

export interface ComentarioClickup {
  id: string;
  autor: string;
  fecha: string;
  texto: string;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const BASE = 'https://api.clickup.com/api/v2';

export const codigoDeNombre = (nombre: string): string | undefined => /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\b/.exec(nombre)?.[1];

/**
 * Cliente mínimo de la API REST de ClickUp con el token personal de cada persona.
 * El token no se guarda aquí: lo recibe quien llama (la app lo guarda cifrado con el llavero del sistema).
 */
export class ClickUp {
  constructor(
    private token: string,
    private fetchFn: Fetch = fetch as unknown as Fetch,
    private base = BASE,
  ) {}

  private async pedir<T>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const r = await this.fetchFn(`${this.base}${ruta}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: this.token, 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (r.status === 401) throw new Error('ClickUp rechazó el token (401). Revisa que sea tu token personal.');
    if (r.status === 429) throw new Error('ClickUp limitó las peticiones (429). Espera un minuto.');
    if (!r.ok) throw new Error(`ClickUp respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  }

  async yo(): Promise<{ id: number; usuario: string }> {
    const r = await this.pedir<{ user: { id: number; username: string } }>('/user');
    return { id: r.user.id, usuario: r.user.username };
  }

  async tareasDeLista(listaId: string, incluirCerradas = false): Promise<TareaClickup[]> {
    const salida: TareaClickup[] = [];
    for (let pagina = 0; pagina < 20; pagina++) {
      const r = await this.pedir<{ tasks: Record<string, unknown>[]; last_page?: boolean }>(`/list/${listaId}/task?page=${pagina}&include_closed=${incluirCerradas}`);
      for (const t of r.tasks) {
        const nombre = String(t.name ?? '');
        const deps = (t.dependencies as { task_id: string; depends_on: string }[] | undefined) ?? [];
        salida.push({
          id: String(t.id),
          codigo: codigoDeNombre(nombre) ?? String(t.id),
          nombre,
          estado: String((t.status as { status?: string } | undefined)?.status ?? ''),
          lista: listaId,
          asignados: ((t.assignees as { username: string }[] | undefined) ?? []).map((a) => a.username),
          ...(t.due_date ? { vence: new Date(Number(t.due_date)).toISOString() } : {}),
          dependeDe: deps.filter((d) => d.task_id === String(t.id)).map((d) => d.depends_on),
        });
      }
      if (r.last_page !== false || r.tasks.length === 0) break;
    }
    return salida;
  }

  async comentarios(tareaId: string): Promise<ComentarioClickup[]> {
    const r = await this.pedir<{ comments: { id: string; comment_text: string; date: string; user: { username: string } }[] }>(`/task/${tareaId}/comment`);
    return r.comments.map((c) => ({ id: String(c.id), autor: c.user.username, fecha: new Date(Number(c.date)).toISOString(), texto: c.comment_text }));
  }

  /** Publica un comentario. Quien llama debe haber obtenido antes la aprobación de una persona. */
  async comentar(tareaId: string, texto: string): Promise<string> {
    const r = await this.pedir<{ id: string | number }>(`/task/${tareaId}/comment`, { method: 'POST', body: { comment_text: texto, notify_all: false } });
    return String(r.id);
  }

  async cambiarEstado(tareaId: string, estado: string): Promise<void> {
    await this.pedir(`/task/${tareaId}`, { method: 'PUT', body: { status: estado } });
  }
}

// ---------- De tareas de ClickUp a un plan ----------

const CERRADAS = /^(completed|closed|complete|done)$/i;

function rolDeCodigo(c: string): RolId {
  if (/-TEST(-|$)/.test(c)) return 'tester';
  if (/-INT(-|$)/.test(c) || /^INT-/.test(c)) return 'integrador';
  if (/^(S\d+-WEI-)?DOC-|^REV-|-DOC-/.test(c) || /^UI-/.test(c)) return 'documentador';
  return 'desarrollador';
}

/** ClickUp no guarda líneas de código: estas son estimaciones por tipo de tarea, que la persona puede corregir. */
export function lineasEstimadas(codigo: string): number {
  if (/-BE(-|$)/.test(codigo)) return 400;
  if (/-FE(-|$)/.test(codigo)) return 300;
  if (/-TEST(-|$)/.test(codigo)) return 200;
  if (/-INT(-|$)/.test(codigo) || /^INT-/.test(codigo)) return 150;
  return 120;
}

export function tareasAPlan(tareas: TareaClickup[], estimaciones: Record<string, number> = {}): TareaPlan[] {
  const abiertas = tareas.filter((t) => !CERRADAS.test(t.estado));
  const porId = new Map(abiertas.map((t) => [t.id, t.codigo]));
  return abiertas.map((t) => ({
    codigo: t.codigo,
    titulo: t.nombre.replace(/^[A-Z0-9-]+\s*[—–-]\s*/, ''),
    lineas: estimaciones[t.codigo] ?? lineasEstimadas(t.codigo),
    dependeDe: t.dependeDe.map((d) => porId.get(d)).filter((c): c is string => Boolean(c)),
    rol: rolDeCodigo(t.codigo),
    ...(t.asignados.length > 0 ? { responsables: t.asignados } : {}),
  }));
}
