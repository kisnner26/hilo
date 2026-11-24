import { estimarTokens } from './context.js';
import type { CliId } from './profile.js';

/**
 * Medición honesta del gasto. Dos cifras distintas y por separado:
 *  - lo gastado de verdad, que cuenta la propia CLI del agente (Claude Code o Codex) al terminar cada paso;
 *  - lo evitado, que compara el texto crudo que había con el que Hilo mandó (caracteres entre 4).
 */

export interface UsoAgente {
  entrada: number;
  salida: number;
  /** Tokens leídos del caché de prompts: cuestan una fracción. */
  cacheLeida: number;
  cacheCreada: number;
  costoUsd?: number;
}

export function usoDeLinea(cli: CliId, linea: string): UsoAgente | undefined {
  try {
    const e = JSON.parse(linea) as Record<string, unknown>;
    if (cli === 'claude') {
      if (e.type !== 'result') return undefined;
      const u = (e.usage ?? {}) as Record<string, number | undefined>;
      return {
        entrada: u.input_tokens ?? 0,
        salida: u.output_tokens ?? 0,
        cacheLeida: u.cache_read_input_tokens ?? 0,
        cacheCreada: u.cache_creation_input_tokens ?? 0,
        ...(typeof e.total_cost_usd === 'number' ? { costoUsd: e.total_cost_usd } : {}),
      };
    }
    const u = ((e.msg ?? e) as { type?: string; usage?: Record<string, number | undefined>; info?: { total_token_usage?: Record<string, number | undefined> } });
    const t = u.usage ?? u.info?.total_token_usage;
    if (!t || !/turn\.completed|token_count/.test(String(e.type ?? u.type ?? ''))) return undefined;
    return { entrada: t.input_tokens ?? 0, salida: t.output_tokens ?? 0, cacheLeida: t.cached_input_tokens ?? 0, cacheCreada: 0 };
  } catch {
    return undefined;
  }
}

export interface Evitado {
  tecnica: string;
  antes: number;
  despues: number;
}

/** Cuánto pesaba lo crudo y cuánto se mandó. Solo cuenta si de verdad se redujo. */
export function evitado(tecnica: string, crudo: string, enviado: string): Evitado {
  return { tecnica, antes: estimarTokens(crudo), despues: estimarTokens(enviado) };
}

export interface RegistroUso {
  fecha: string;
  paso: string;
  ref: string;
  modelo: string;
  ms: number;
  uso?: UsoAgente;
  evitados: Evitado[];
  /** Se resolvió con datos locales o con el caché de un paso idéntico: no gastó nada. */
  local?: boolean;
}

export interface ResumenUso {
  pasos: number;
  locales: number;
  entrada: number;
  salida: number;
  cacheLeida: number;
  costoUsd: number;
  /** Tokens que no se mandaron gracias a cada técnica. */
  porTecnica: { tecnica: string; tokens: number; veces: number }[];
  tokensEvitados: number;
  /** Lo que habría entrado sin técnicas: lo enviado de verdad más lo evitado. */
  tokensSinHilo: number;
  /** Fracción de entrada que no llegó al modelo, de 0 a 1. */
  ahorro: number;
}

export function resumirUso(registros: RegistroUso[]): ResumenUso {
  const por = new Map<string, { tokens: number; veces: number }>();
  let entrada = 0;
  let salida = 0;
  let cacheLeida = 0;
  let costoUsd = 0;
  for (const r of registros) {
    entrada += (r.uso?.entrada ?? 0) + (r.uso?.cacheCreada ?? 0);
    salida += r.uso?.salida ?? 0;
    cacheLeida += r.uso?.cacheLeida ?? 0;
    costoUsd += r.uso?.costoUsd ?? 0;
    for (const e of r.evitados) {
      const ganado = Math.max(0, e.antes - e.despues);
      if (ganado === 0) continue;
      const x = por.get(e.tecnica) ?? { tokens: 0, veces: 0 };
      por.set(e.tecnica, { tokens: x.tokens + ganado, veces: x.veces + 1 });
    }
  }
  const porTecnica = [...por.entries()].map(([tecnica, v]) => ({ tecnica, ...v })).sort((a, b) => b.tokens - a.tokens);
  const tokensEvitados = porTecnica.reduce((n, x) => n + x.tokens, 0);
  const enviado = entrada + cacheLeida;
  return {
    pasos: registros.length,
    locales: registros.filter((r) => r.local).length,
    entrada,
    salida,
    cacheLeida,
    costoUsd,
    porTecnica,
    tokensEvitados,
    tokensSinHilo: enviado + tokensEvitados,
    ahorro: enviado + tokensEvitados === 0 ? 0 : tokensEvitados / (enviado + tokensEvitados),
  };
}
