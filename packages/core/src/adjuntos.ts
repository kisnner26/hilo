import { inflateRawSync } from 'node:zlib';
import { extractoRelevante } from './ahorro.js';
import { estimarTokens } from './context.js';

/**
 * Adjuntos del asistente: qué es cada archivo, cómo leerlo en tu equipo y cuánto mandar al agente.
 * La idea es que un archivo cueste lo menos posible: el texto se extrae aquí, las imágenes se reducen
 * o se leen con OCR, y solo se manda lo que importa para la pregunta.
 */

export type TipoAdjunto = 'imagen' | 'pdf' | 'office' | 'datos' | 'texto' | 'comprimido' | 'otro';

const EXT_IMAGEN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic']);
const EXT_OFFICE = new Set(['docx', 'pptx', 'xlsx']);
const EXT_DATOS = new Set(['csv', 'tsv']);
const EXT_COMPRIMIDO = new Set(['zip', 'jar', 'war']);
const EXT_TEXTO = new Set(['txt', 'md', 'markdown', 'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'java', 'kt', 'py', 'rb', 'go', 'rs', 'c', 'h', 'cpp', 'cs', 'php', 'sql', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'gradle', 'log', 'rtf', 'tex', 'swift', 'vue', 'svelte', 'dockerfile', 'gitignore', 'diff', 'patch']);

export const extensionDe = (nombre: string): string => {
  const base = nombre.split(/[\\/]/).pop() ?? nombre;
  const i = base.lastIndexOf('.');
  return (i > 0 ? base.slice(i + 1) : base).toLowerCase();
};

/** Qué tipo de archivo es, mirando primero sus primeros bytes y después su extensión. */
export function clasificar(nombre: string, cabecera: Uint8Array): { tipo: TipoAdjunto; formato: string } {
  const b = cabecera;
  const empieza = (...x: number[]) => x.every((v, i) => b[i] === v);
  if (empieza(0x89, 0x50, 0x4e, 0x47)) return { tipo: 'imagen', formato: 'png' };
  if (empieza(0xff, 0xd8, 0xff)) return { tipo: 'imagen', formato: 'jpg' };
  if (empieza(0x47, 0x49, 0x46, 0x38)) return { tipo: 'imagen', formato: 'gif' };
  if (empieza(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return { tipo: 'imagen', formato: 'webp' };
  if (empieza(0x25, 0x50, 0x44, 0x46)) return { tipo: 'pdf', formato: 'pdf' };
  const ext = extensionDe(nombre);
  if (empieza(0x50, 0x4b, 0x03, 0x04)) return EXT_OFFICE.has(ext) ? { tipo: 'office', formato: ext } : { tipo: 'comprimido', formato: ext || 'zip' };
  if (EXT_IMAGEN.has(ext)) return { tipo: 'imagen', formato: ext };
  if (ext === 'pdf') return { tipo: 'pdf', formato: 'pdf' };
  if (EXT_DATOS.has(ext)) return { tipo: 'datos', formato: ext };
  if (EXT_TEXTO.has(ext) || esTexto(b)) return { tipo: 'texto', formato: ext || 'txt' };
  if (EXT_COMPRIMIDO.has(ext)) return { tipo: 'comprimido', formato: ext };
  return { tipo: 'otro', formato: ext || 'bin' };
}

/** Si la muestra parece texto: sin bytes de control raros. */
export function esTexto(muestra: Uint8Array): boolean {
  if (muestra.length === 0) return true;
  let raros = 0;
  const n = Math.min(muestra.length, 4096);
  for (let i = 0; i < n; i++) {
    const c = muestra[i]!;
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) raros++;
  }
  return raros / n < 0.02;
}

// ---------- Imágenes ----------

/** Lo que cuesta una imagen: ancho por alto entre 750, con el tope que aplica el modelo. */
export const tokensDeImagen = (ancho: number, alto: number): number => Math.min(1600, Math.ceil((ancho * alto) / 750));

export interface PlanImagen {
  ancho: number;
  alto: number;
  reducir: boolean;
}

/** Reduce el lado largo hasta `ladoMax` sin agrandar nunca. */
export function planDeImagen(ancho: number, alto: number, ladoMax: number): PlanImagen {
  const lado = Math.max(ancho, alto);
  if (lado <= ladoMax) return { ancho, alto, reducir: false };
  const f = ladoMax / lado;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)), reducir: true };
}

/**
 * Una imagen con mucho texto (una captura de un error, un documento) se manda mejor como texto:
 * cuesta una fracción y el modelo lo lee igual. Una foto o un diagrama, no.
 */
export function esImagenDeTexto(ocr: string): boolean {
  const limpio = ocr.trim();
  const lineas = limpio.split('\n').filter((l) => l.trim().length > 2).length;
  return limpio.length >= 400 && lineas >= 6;
}

// ---------- ZIP y documentos de Office ----------

/** Lector mínimo de ZIP (almacenado y deflate) para abrir docx, pptx y xlsx sin dependencias. */
export function leerZip(buf: Buffer): Map<string, Buffer> {
  const salida = new Map<string, Buffer>();
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('No es un archivo ZIP válido.');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const comp = buf.readUInt32LE(p + 20);
    const nom = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const coment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + nom).toString('utf8');
    p += 46 + nom + extra + coment;
    if (nombre.endsWith('/')) continue;
    const datos = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const crudo = buf.subarray(datos, datos + comp);
    salida.set(nombre, metodo === 0 ? crudo : metodo === 8 ? inflateRawSync(crudo) : Buffer.alloc(0));
  }
  return salida;
}

const ENTIDADES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const desescapar = (s: string): string => s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);/g, (m, _n, num) => (num ? String.fromCodePoint(Number(num)) : (ENTIDADES[m] ?? m)));
const textoXml = (xml: string, etiqueta: string): string[] => [...xml.matchAll(new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([^<]*)</${etiqueta}>`, 'g'))].map((m) => desescapar(m[1]!));
const numeroEnNombre = (n: string): number => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);

export function textoDeOffice(buf: Buffer, formato: string): string {
  const z = leerZip(buf);
  const txt = (n: string) => z.get(n)?.toString('utf8') ?? '';
  if (formato === 'docx') {
    const xml = txt('word/document.xml');
    return xml
      .split(/<\/w:p>/)
      .map((p) => textoXml(p.replace(/<w:tab\/>/g, '<w:t>\t</w:t>'), 'w:t').join(''))
      .filter((l) => l.trim())
      .join('\n');
  }
  if (formato === 'pptx') {
    return [...z.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => numeroEnNombre(a) - numeroEnNombre(b))
      .map((n, i) => `## diapositiva ${i + 1}\n${textoXml(txt(n).replace(/<\/a:p>/g, '</a:p>'), 'a:t').join(' ')}`)
      .join('\n\n');
  }
  // xlsx: las celdas de texto apuntan a una tabla compartida de cadenas.
  const compartidas = [...txt('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoXml(m[1]!, 't').join(''));
  return [...z.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => numeroEnNombre(a) - numeroEnNombre(b))
    .map((n, i) => {
      const filas = [...txt(n).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 300).map((r) =>
        [...r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map((c) => {
            const v = /<v>([^<]*)<\/v>/.exec(c[2] ?? '')?.[1] ?? '';
            return /t="s"/.test(c[1] ?? '') ? (compartidas[Number(v)] ?? '') : desescapar(v);
          })
          .join('\t'),
      );
      return `## hoja ${i + 1}\n${filas.join('\n')}`;
    })
    .join('\n\n');
}

// ---------- Tablas, texto y archivos desconocidos ----------

/** Una tabla grande no se manda entera: encabezado, las primeras filas, las últimas y cuántas hay. */
export function resumirTabla(texto: string, maxFilas = 25): string {
  const filas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (filas.length <= maxFilas + 5) return texto;
  const cabeza = filas.slice(0, maxFilas);
  const cola = filas.slice(-5);
  return [...cabeza, `[… ${filas.length - maxFilas - 5} filas más, ${filas.length - 1} en total …]`, ...cola].join('\n');
}

/**
 * Deja del texto solo lo que cabe en `maxTokens`: el principio (de qué trata) y los párrafos
 * que más tocan la pregunta. Menos tokens, la misma respuesta.
 */
export function podarTexto(texto: string, consulta: string, maxTokens: number): string {
  if (estimarTokens(texto) <= maxTokens) return texto;
  const maxChars = maxTokens * 4;
  const cabeza = texto.slice(0, Math.floor(maxChars * 0.2)).trimEnd();
  const relevante = extractoRelevante(texto.slice(cabeza.length), consulta, Math.floor(maxChars * 0.75));
  return `${cabeza}\n[… recortado: ${estimarTokens(texto).toLocaleString('es')} tokens en total; abajo, lo que más toca tu pregunta …]\n${relevante}`;
}

/** Lo que se puede decir de un archivo que no se sabe leer: qué parece y las palabras legibles que contiene. */
export function describirBinario(nombre: string, datos: Buffer): string {
  const firmas: [number[], string][] = [
    [[0x7f, 0x45, 0x4c, 0x46], 'ejecutable ELF (Linux)'],
    [[0x4d, 0x5a], 'ejecutable de Windows (PE)'],
    [[0xcf, 0xfa, 0xed, 0xfe], 'ejecutable de macOS (Mach-O)'],
    [[0x53, 0x51, 0x4c, 0x69, 0x74, 0x65], 'base de datos SQLite'],
    [[0x1f, 0x8b], 'archivo comprimido gzip'],
    [[0x52, 0x61, 0x72, 0x21], 'archivo comprimido RAR'],
    [[0x37, 0x7a, 0xbc, 0xaf], 'archivo comprimido 7z'],
    [[0x49, 0x44, 0x33], 'audio MP3'],
  ];
  const tipo = firmas.find(([f]) => f.every((v, i) => datos[i] === v))?.[1] ?? 'binario desconocido';
  const palabras = [...datos.subarray(0, 2_000_000).toString('latin1').matchAll(/[\x20-\x7e]{6,}/g)].map((m) => m[0]!).slice(0, 40);
  return [`Archivo «${nombre}»: ${tipo}, ${datos.length.toLocaleString('es')} bytes.`, palabras.length ? `Texto legible dentro (primeras ${palabras.length} cadenas):\n${palabras.join('\n')}` : 'No contiene texto legible.'].join('\n');
}

export function listarZip(buf: Buffer): string {
  const z = leerZip(buf);
  const lineas = [...z.entries()].slice(0, 80).map(([n, d]) => `${n} (${d.length.toLocaleString('es')} bytes)`);
  return `Contiene ${z.size} archivos${z.size > 80 ? ' (se muestran 80)' : ''}:\n${lineas.join('\n')}`;
}

export interface TextoExtraido {
  texto: string;
  /** Cómo se obtuvo, para mostrarlo: «leído del archivo», «hoja de cálculo», etc. */
  metodo: string;
}

/** Extrae el texto de lo que se lee sin ayuda externa. Los PDF y las imágenes los resuelve el OCR del sistema. */
export function extraerTexto(nombre: string, tipo: TipoAdjunto, formato: string, datos: Buffer): TextoExtraido | undefined {
  try {
    if (tipo === 'texto') {
      const t = datos.toString('utf8');
      return { texto: formato === 'rtf' ? t.replace(/\\[a-z]+-?\d* ?|[{}]/g, '') : formato === 'html' || formato === 'htm' ? t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ') : t, metodo: 'leído del archivo' };
    }
    if (tipo === 'datos') return { texto: resumirTabla(datos.toString('utf8')), metodo: 'tabla resumida' };
    if (tipo === 'office') return { texto: textoDeOffice(datos, formato), metodo: formato === 'xlsx' ? 'hoja de cálculo' : formato === 'pptx' ? 'presentación' : 'documento de Word' };
    if (tipo === 'comprimido') return { texto: listarZip(datos), metodo: 'lista de contenido' };
    if (tipo === 'otro') return { texto: describirBinario(nombre, datos), metodo: 'análisis del binario' };
  } catch {
    return undefined;
  }
  return undefined;
}
