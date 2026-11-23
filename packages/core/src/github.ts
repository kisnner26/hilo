import { execFileSync } from 'node:child_process';
import type { Cambio } from './rules.js';

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Trae un PR de GitHub como Cambio, para revisarlo contra todas las reglas en un solo informe. */
export function cambioDePr(numero: string | number, repo: string): Cambio {
  const meta = JSON.parse(gh('pr', 'view', String(numero), '-R', repo, '--json', 'headRefName,title,body,labels')) as {
    headRefName: string;
    title: string;
    body: string;
    labels: { name: string }[];
  };
  const archivos = JSON.parse(
    gh(
      'api',
      `repos/${repo}/pulls/${numero}/files`,
      '--paginate',
      '--jq',
      '[.[]|{ruta:.filename,estado:(if .status=="added" then "A" elif .status=="removed" then "D" elif .status=="renamed" then "R" else "M" end),adiciones:.additions,eliminaciones:.deletions}]',
    ),
  ) as Cambio['archivos'];
  return { rama: meta.headRefName, titulo: meta.title, cuerpo: meta.body ?? '', archivos, etiquetas: meta.labels.map((l) => l.name) };
}

import type { PrEnCola } from './balance.js';

/**
 * Cola de PR abiertos para repartir entre integradores.
 * `rondas` es una aproximación: comentarios y revisiones de integradores en ese PR.
 */
export function colaDePrs(repo: string, integradores: string[]): PrEnCola[] {
  const abiertos = JSON.parse(gh('pr', 'list', '-R', repo, '--state', 'open', '--limit', '60', '--json', 'number,author,isDraft,additions,deletions')) as {
    number: number;
    author: { login: string };
    isDraft: boolean;
    additions: number;
    deletions: number;
  }[];
  return abiertos.map((p) => {
    const voces = (ruta: string): string[] => {
      try {
        return JSON.parse(gh('api', ruta, '--paginate', '--jq', '[.[]|.user.login]')) as string[];
      } catch {
        return [];
      }
    };
    const dichas = [...voces(`repos/${repo}/issues/${p.number}/comments`), ...voces(`repos/${repo}/pulls/${p.number}/reviews`)];
    return {
      numero: p.number,
      autor: p.author.login,
      rondas: dichas.filter((u) => integradores.includes(u)).length,
      lineas: p.additions + p.deletions,
      listo: !p.isDraft,
    };
  });
}
