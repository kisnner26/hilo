import { spawn } from 'node:child_process';
import { estimarTokens } from './context.js';

/**
 * Motores de IA. Hilo usa el mejor que encuentre sin que nadie configure nada:
 * un agente de suscripción (Claude Code o Codex) y, si no hay, un modelo que corre en el propio equipo
 * (Apple Intelligence en Mac, u Ollama) y, si tampoco, búsqueda y reglas locales.
 */

export type MotorId = 'claude' | 'codex' | 'apple' | 'ollama' | 'reglas';

export interface EstadoMotor {
  id: MotorId;
  nombre: string;
  disponible: boolean;
  detalle: string;
  /** Qué hacer para activarlo, si no está. */
  ayuda?: string;
  /** Corre en tu equipo, sin mandar nada fuera. */
  local: boolean;
  /** Puede editar código y arreglar el CI (los pasos pesados del piloto). */
  puedeEditar: boolean;
}

export const ORDEN_MOTORES: MotorId[] = ['claude', 'codex', 'apple', 'ollama', 'reglas'];

export const NOMBRE_MOTOR: Record<MotorId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  apple: 'Apple Intelligence',
  ollama: 'Ollama',
  reglas: 'Sin IA (búsqueda y reglas)',
};

/** Tokens que caben de verdad en cada modelo local. El de Apple es pequeño: hay que mandarle poco. */
export const CONTEXTO_LOCAL: Partial<Record<MotorId, number>> = { apple: 2800, ollama: 6000 };

/** Un agente de suscripción siempre gana; después, lo que corre en tu equipo; al final, solo reglas. */
export function elegirMotor(estados: Pick<EstadoMotor, 'id' | 'disponible'>[], preferido: 'auto' | MotorId = 'auto'): MotorId {
  const ok = (id: MotorId) => id === 'reglas' || estados.some((e) => e.id === id && e.disponible);
  if (preferido !== 'auto' && ok(preferido)) return preferido;
  return ORDEN_MOTORES.find(ok) ?? 'reglas';
}

export const esAgente = (m: MotorId): boolean => m === 'claude' || m === 'codex';
export const esModeloLocal = (m: MotorId): boolean => m === 'apple' || m === 'ollama';

/** Deja el principio y el final de un texto largo, que es donde está lo importante, hasta caber en `maxTokens`. */
export function recortarParaLocal(texto: string, maxTokens: number): string {
  if (estimarTokens(texto) <= maxTokens) return texto;
  const maxChars = maxTokens * 4;
  const cabeza = Math.floor(maxChars * 0.6);
  const cola = maxChars - cabeza;
  return `${texto.slice(0, cabeza)}\n[… recortado para que quepa en el modelo local …]\n${texto.slice(texto.length - cola)}`;
}

export interface PedidoLocal {
  sistema?: string;
  prompt: string;
  modelo?: string;
  /** Recibe el texto a medida que se escribe. */
  alTexto?: (delta: string) => void;
  senal?: AbortSignal;
}

// ---------- Apple Intelligence ----------

function ejecutarJson(bin: string, args: string[], entrada: string | undefined, alLinea: (l: string) => void, senal?: AbortSignal): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const p = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], ...(senal ? { signal: senal } : {}) });
    let resto = '';
    p.stdout.on('data', (d: Buffer) => {
      resto += d.toString('utf8');
      const ls = resto.split('\n');
      resto = ls.pop() ?? '';
      ls.filter(Boolean).forEach(alLinea);
    });
    p.on('error', rechazar);
    p.on('close', (c) => {
      if (resto.trim()) alLinea(resto);
      resolver(c ?? 1);
    });
    p.stdin.end(entrada ?? '');
  });
}

export async function sondearApple(bin: string): Promise<{ disponible: boolean; razon: string }> {
  let salida: { disponible?: boolean; razon?: string } = {};
  try {
    await ejecutarJson(bin, ['--probar'], undefined, (l) => (salida = JSON.parse(l) as typeof salida));
  } catch {
    return { disponible: false, razon: 'No se pudo ejecutar el ayudante.' };
  }
  return { disponible: Boolean(salida.disponible), razon: salida.razon ?? '' };
}

export const explicarRazonApple = (razon: string): string =>
  /deviceNotEligible/i.test(razon) ? 'Este equipo no es compatible con Apple Intelligence.' : /notEnabled/i.test(razon) ? 'Apple Intelligence está apagado: actívalo en Ajustes del Sistema.' : /modelNotReady/i.test(razon) ? 'El modelo de Apple todavía se está descargando. Prueba en un rato.' : razon || 'No disponible.';

export async function generarApple(bin: string, p: PedidoLocal): Promise<string> {
  let texto = '';
  let error = '';
  const codigo = await ejecutarJson(
    bin,
    [],
    JSON.stringify({ sistema: recortarParaLocal(p.sistema ?? '', 900), prompt: recortarParaLocal(p.prompt, (CONTEXTO_LOCAL.apple ?? 2800) - 900) }),
    (l) => {
      try {
        const j = JSON.parse(l) as { delta?: string; reemplazo?: string; error?: string };
        if (j.delta) {
          texto += j.delta;
          p.alTexto?.(j.delta);
        } else if (j.reemplazo !== undefined) texto = j.reemplazo;
        else if (j.error) error = j.error;
      } catch {
        /* línea de aviso del sistema */
      }
    },
    p.senal,
  );
  if (error || (codigo !== 0 && !texto)) throw new Error(error ? `Apple Intelligence: ${error}` : 'Apple Intelligence no respondió.');
  return texto.trim();
}

// ---------- Ollama ----------

type Cuerpo = { ok: boolean; status: number; body?: ReadableStream<Uint8Array> | null; json(): Promise<unknown> };
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Cuerpo>;

export const BASE_OLLAMA = 'http://127.0.0.1:11434';

export interface ModeloOllama {
  nombre: string;
  bytes: number;
}

export async function sondearOllama(fetchFn: Fetch = fetch as unknown as Fetch, base = BASE_OLLAMA): Promise<{ activo: boolean; modelos: ModeloOllama[] }> {
  try {
    const r = await fetchFn(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { activo: false, modelos: [] };
    const j = (await r.json()) as { models?: { name: string; size: number }[] };
    return { activo: true, modelos: (j.models ?? []).map((m) => ({ nombre: m.name, bytes: m.size })) };
  } catch {
    return { activo: false, modelos: [] };
  }
}

/** Modelos pequeños que entienden bien español, del mejor al menos bueno; no se elige nada de más de 9 GB. */
const PREFERIDOS = [/qwen3/i, /qwen2\.5/i, /gemma3/i, /gemma2/i, /llama3\.[123]/i, /llama3/i, /phi4/i, /phi3/i, /mistral/i];
const SIN_TEXTO = /embed|nomic|bge|minilm|vision|llava|whisper/i;

export function elegirModeloOllama(modelos: ModeloOllama[], preferido?: string): string | undefined {
  if (preferido && modelos.some((m) => m.nombre === preferido)) return preferido;
  const utiles = modelos.filter((m) => !SIN_TEXTO.test(m.nombre) && m.bytes <= 9_000_000_000);
  for (const re of PREFERIDOS) {
    const c = utiles.filter((m) => re.test(m.nombre)).sort((a, b) => a.bytes - b.bytes);
    if (c.length > 0) return c[c.length - 1]!.nombre;
  }
  return utiles.sort((a, b) => b.bytes - a.bytes)[0]?.nombre;
}

export async function generarOllama(p: PedidoLocal, modelo: string, fetchFn: Fetch = fetch as unknown as Fetch, base = BASE_OLLAMA): Promise<string> {
  const r = await fetchFn(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(p.senal ? { signal: p.senal } : {}),
    body: JSON.stringify({
      model: modelo,
      stream: true,
      options: { num_ctx: CONTEXTO_LOCAL.ollama ?? 6000, temperature: 0.3 },
      messages: [...(p.sistema ? [{ role: 'system', content: p.sistema }] : []), { role: 'user', content: recortarParaLocal(p.prompt, (CONTEXTO_LOCAL.ollama ?? 6000) - 800) }],
    }),
  });
  if (!r.ok || !r.body) throw new Error(`Ollama respondió ${r.status}. ¿Está abierto y tiene el modelo ${modelo}?`);
  const lector = r.body.getReader();
  const dec = new TextDecoder();
  let resto = '';
  let texto = '';
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const ls = resto.split('\n');
    resto = ls.pop() ?? '';
    for (const l of ls.filter(Boolean)) {
      const j = JSON.parse(l) as { message?: { content?: string }; error?: string };
      if (j.error) throw new Error(`Ollama: ${j.error}`);
      const d = j.message?.content ?? '';
      if (d) {
        texto += d;
        p.alTexto?.(d);
      }
    }
  }
  return texto.trim();
}
