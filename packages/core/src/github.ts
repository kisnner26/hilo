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
