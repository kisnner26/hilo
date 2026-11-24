/**
 * Actualizaciones desde la propia app: se compara la versión instalada con la última publicada en GitHub
 * y, cuando la persona lo pide, se descarga el archivo de su sistema y se reemplaza la app.
 * Hilo no está firmado, así que no puede usar el actualizador de Electron; esto hace lo mismo con pasos explícitos.
 */

export const REPO_HILO = 'kisnner26/hilo';

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface AssetRelease {
  nombre: string;
  url: string;
  tam: number;
}
export interface Actualizacion {
  hay: boolean;
  actual: string;
  ultima: string;
  notas: string;
  pagina: string;
  publicada: string;
  /** El archivo que corresponde a este sistema, si lo hay. */
  asset?: AssetRelease;
}

/** Compara "0.1.10" con "0.1.9": devuelve positivo si a es más nueva. Ignora la "v" y lo que sigue a un guion. */
export function compararVersiones(a: string, b: string): number {
  const partes = (v: string) => v.replace(/^v/i, '').split('-')[0]!.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const x = partes(a);
  const y = partes(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** El archivo de la versión que corresponde al sistema y a la arquitectura. */
export function elegirAsset(assets: AssetRelease[], plataforma: string, arquitectura: string): AssetRelease | undefined {
  if (plataforma === 'darwin') {
    return arquitectura === 'arm64' ? assets.find((a) => /-arm64-mac\.zip$/i.test(a.nombre)) : assets.find((a) => /-mac\.zip$/i.test(a.nombre) && !/arm64/i.test(a.nombre));
  }
  if (plataforma === 'win32') return assets.find((a) => /setup.*\.exe$/i.test(a.nombre));
  if (plataforma === 'linux') return assets.find((a) => /\.AppImage$/i.test(a.nombre));
  return undefined;
}

/** Solo se descargan archivos publicados por el propio repositorio de Hilo. */
export const urlDeConfianza = (url: string, repo = REPO_HILO): boolean => url.startsWith(`https://github.com/${repo}/releases/download/`);

interface ReleaseCruda {
  tag_name: string;
  body?: string | null;
  html_url: string;
  published_at: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

export async function buscarActualizacion(actual: string, plataforma: string, arquitectura: string, fetchFn: Fetch = fetch as unknown as Fetch, repo = REPO_HILO): Promise<Actualizacion> {
  const r = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hilo' } });
  if (r.status === 404) throw new Error('Todavía no hay versiones publicadas.');
  if (r.status === 403) throw new Error('GitHub limitó las consultas. Prueba en unos minutos.');
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al buscar actualizaciones.`);
  const j = (await r.json()) as ReleaseCruda;
  const ultima = j.tag_name.replace(/^v/i, '');
  const asset = elegirAsset(
    j.assets.map((a) => ({ nombre: a.name, url: a.browser_download_url, tam: a.size })),
    plataforma,
    arquitectura,
  );
  return {
    hay: compararVersiones(ultima, actual) > 0,
    actual,
    ultima,
    notas: (j.body ?? '').trim(),
    pagina: j.html_url,
    publicada: j.published_at,
    ...(asset && urlDeConfianza(asset.url, repo) ? { asset } : {}),
  };
}

/** Entre comillas simples para el shell, sin que ninguna ruta pueda salirse de ellas. */
export const entreComillas = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Script de macOS: espera a que Hilo cierre, descomprime la versión nueva, guarda la anterior por si falla,
 * la reemplaza, quita la cuarentena y la abre.
 */
export function scriptReemplazoMac(o: { pid: number; zip: string; destino: string }): string {
  const z = entreComillas(o.zip);
  const d = entreComillas(o.destino);
  const ant = entreComillas(`${o.destino}.anterior`);
  return [
    '#!/bin/sh',
    `while kill -0 ${Math.trunc(o.pid)} 2>/dev/null; do sleep 0.5; done`,
    'TMP=$(mktemp -d) || exit 1',
    `ditto -xk ${z} "$TMP" || { rm -rf "$TMP"; open ${d}; exit 1; }`,
    'NUEVA=$(find "$TMP" -maxdepth 2 -name "*.app" -type d | head -1)',
    `[ -n "$NUEVA" ] || { rm -rf "$TMP"; open ${d}; exit 1; }`,
    `rm -rf ${ant}`,
    `mv ${d} ${ant} || { rm -rf "$TMP"; open ${d}; exit 1; }`,
    `if ditto "$NUEVA" ${d}; then rm -rf ${ant}; xattr -cr ${d}; else rm -rf ${d}; mv ${ant} ${d}; fi`,
    `rm -rf "$TMP" ${z}`,
    `open ${d}`,
    '',
  ].join('\n');
}

/** Script de Linux (AppImage): espera, reemplaza el archivo y lo vuelve a abrir. */
export function scriptReemplazoAppImage(o: { pid: number; nuevo: string; destino: string }): string {
  const n = entreComillas(o.nuevo);
  const d = entreComillas(o.destino);
  return [
    '#!/bin/sh',
    `while kill -0 ${Math.trunc(o.pid)} 2>/dev/null; do sleep 0.5; done`,
    `chmod +x ${n} && mv -f ${n} ${d}`,
    `nohup ${d} >/dev/null 2>&1 &`,
    '',
  ].join('\n');
}
