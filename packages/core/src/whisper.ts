import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Dictado con Whisper (whisper.cpp): corre en tu equipo, entiende inglés y español sin que elijas
 * y no manda el audio a ningún servicio. Aquí solo hay lo que no depende de la ventana: argumentos,
 * limpieza del texto, formato WAV y una llamada a la herramienta.
 */

/** Palabras del trabajo diario: ayudan a que «pull request» o «ClickUp» no salgan como otra cosa. */
export const PROMPT_TECNICO = 'Hilo, GitHub, ClickUp, pull request, PR, commit, merge, Claude, Codex, backend, frontend, BFA, GEN, sprint.';

export const MODELO_RECOMENDADO = { archivo: 'ggml-small-q5_1.bin', url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin', bytesMinimos: 150_000_000 };

export interface OpcionesWhisper {
  modelo: string;
  archivo: string;
  /** "auto" deja que Whisper decida; o un código como "es" o "en". */
  idioma: string;
  hilos?: number;
  /** Para los avances en vivo: más rápido y algo menos fino. La pasada final no lo usa. */
  rapido?: boolean;
  prompt?: string;
}

export function argumentosWhisper(o: OpcionesWhisper): string[] {
  return ['-m', o.modelo, '-f', o.archivo, '-l', o.idioma, '-nt', '-np', '-t', String(o.hilos ?? 4), ...(o.rapido ? ['-bs', '1', '-bo', '1'] : []), '--prompt', o.prompt ?? PROMPT_TECNICO];
}

export const argumentosDeteccion = (modelo: string, archivo: string, hilos = 4): string[] => ['-m', modelo, '-f', archivo, '-dl', '-t', String(hilos)];

export function leerIdioma(salida: string): { codigo: string; p: number } | undefined {
  const m = /auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)/i.exec(salida);
  return m ? { codigo: m[1]!.toLowerCase(), p: Number(m[2]) } : undefined;
}

/** Entre los idiomas que se usan (español e inglés), el que detectó Whisper; si es otro, el de siempre. */
export function elegirIdioma(det: { codigo: string; p: number } | undefined, permitidos = ['es', 'en'], porDefecto = 'es'): string {
  return det && permitidos.includes(det.codigo) ? det.codigo : porDefecto;
}

const ALUCINACIONES = /^(subt[ií]tulos?.*|.*amara\.org.*|gracias por (ver|vernos|su atenci[oó]n).*|thanks? for watching.*|thank you\.?|suscr[ií]bete.*|subscribe.*|you|\.+|¡?gracias!?\.?)$/i;

/** Quita lo que Whisper inventa en los silencios: marcas entre corchetes, música y despedidas de video. */
export function limpiarTranscripcion(t: string): string {
  const sin = t
    .replace(/\[[^\]]*\]|\([^)]*\)|♪[^♪]*♪|♪/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !ALUCINACIONES.test(l))
    .join(' ')
    .trim();
  return ALUCINACIONES.test(sin) ? '' : sin;
}

/** PCM de 16 bits y un canal, con la cabecera WAV que espera whisper.cpp. */
export function escribirWav(pcm: Int16Array, frecuencia = 16_000): Buffer {
  const datos = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0);
  cab.writeUInt32LE(36 + datos.length, 4);
  cab.write('WAVEfmt ', 8);
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);
  cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(frecuencia, 24);
  cab.writeUInt32LE(frecuencia * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write('data', 36);
  cab.writeUInt32LE(datos.length, 40);
  return Buffer.concat([cab, datos]);
}

/** Volumen eficaz (0 a 1): sirve para no mandar silencio a Whisper, que entonces inventa texto. */
export function volumen(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let s = 0;
  for (const v of pcm) s += (v / 32768) ** 2;
  return Math.sqrt(s / pcm.length);
}

export interface ResultadoWhisper {
  texto: string;
  idioma: string;
  ms: number;
}

async function conWav<T>(pcm: Int16Array, f: (ruta: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'hilo-voz-'));
  const ruta = join(dir, 'voz.wav');
  try {
    writeFileSync(ruta, escribirWav(pcm));
    return await f(ruta);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Detecta si hablas español o inglés con unos segundos de audio. */
export async function detectarIdioma(bin: string, modelo: string, pcm: Int16Array): Promise<string> {
  return conWav(pcm, async (archivo) => {
    const { stdout, stderr } = await exec(bin, argumentosDeteccion(modelo, archivo), { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }).catch((e: { stdout?: string; stderr?: string }) => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
    return elegirIdioma(leerIdioma(`${stdout}\n${stderr}`));
  });
}

export async function transcribir(bin: string, o: Omit<OpcionesWhisper, 'archivo'>, pcm: Int16Array): Promise<ResultadoWhisper> {
  const inicio = Date.now();
  return conWav(pcm, async (archivo) => {
    const { stdout } = await exec(bin, argumentosWhisper({ ...o, archivo }), { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return { texto: limpiarTranscripcion(stdout), idioma: o.idioma, ms: Date.now() - inicio };
  });
}
