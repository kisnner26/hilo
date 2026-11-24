import { app, ipcMain, shell, systemPreferences } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as core from '@hilo/core';

/**
 * Dictado por voz con dos motores:
 *  - Whisper (whisper.cpp): corre en tu equipo, detecta solo si hablas español o inglés y es el más preciso.
 *    La interfaz captura el micrófono y manda el audio aquí; los avances salen cada ~1,5 s.
 *  - Apple: el reconocimiento de voz del sistema, solo macOS y con un idioma fijo. Es el respaldo.
 */

type Motor = 'whisper' | 'apple' | 'ninguno';
type Idioma = 'auto' | 'es' | 'en';

const carpetaModelos = () => join(app.getPath('userData'), 'modelos');

function modeloWhisper(): string | undefined {
  const env = process.env.HILO_MODELO_VOZ;
  if (env && existsSync(env)) return env;
  try {
    const d = carpetaModelos();
    const lista = readdirSync(d)
      .filter((f) => /^ggml-.*\.bin$/.test(f))
      .map((f) => ({ f: join(d, f), n: statSync(join(d, f)).size }))
      .filter((x) => x.n >= core.MODELO_RECOMENDADO.bytesMinimos / 3)
      .sort((a, b) => b.n - a.n);
    return lista[0]?.f;
  } catch {
    return undefined;
  }
}

const binWhisper = (): string | undefined => core.buscar('whisper-cli') ?? core.buscar('whisper-cpp');

const rutaApple = (): string | undefined => {
  const r = app.isPackaged ? join(process.resourcesPath, 'native', 'hilo-dictado') : resolve(__dirname, '../../native/bin/hilo-dictado');
  return process.platform === 'darwin' && existsSync(r) ? r : undefined;
};

function motorActual(): { motor: Motor; bin?: string; modelo?: string } {
  const bin = binWhisper();
  const modelo = modeloWhisper();
  if (bin && modelo) return { motor: 'whisper', bin, modelo };
  return { motor: rutaApple() ? 'apple' : 'ninguno' };
}

interface Sesion {
  trozos: Int16Array[];
  muestras: number;
  /** Muestras ya incluidas en la última pasada de avance. */
  vistas: number;
  idioma: Idioma;
  fijado?: string;
  ocupada: boolean;
  cerrando: boolean;
  tiempo: ReturnType<typeof setInterval>;
}

const MAX_SEGUNDOS = 90;
let sesion: Sesion | undefined;
let apple: ChildProcessWithoutNullStreams | undefined;

function juntar(s: Sesion, maxSeg?: number): Int16Array {
  const tope = maxSeg ? maxSeg * 16_000 : Infinity;
  const todo = new Int16Array(s.muestras);
  let o = 0;
  for (const t of s.trozos) {
    todo.set(t, o);
    o += t.length;
  }
  return todo.length > tope ? todo.subarray(todo.length - tope) : todo;
}

export function registrarDictado(enviar: (canal: string, datos: unknown) => void): void {
  const emitir = (e: Record<string, unknown>) => enviar('dictado:evento', e);

  async function pasada(s: Sesion, final: boolean): Promise<void> {
    const { bin, modelo } = motorActual();
    if (!bin || !modelo) return;
    const pcm = juntar(s, 28);
    if (pcm.length < 16_000 * 0.5 || core.volumen(pcm) < 0.004) {
      if (final) emitir({ tipo: 'final', texto: '' });
      return;
    }
    // El idioma se decide con la primera voz clara y se mantiene; en la pasada final se confirma con todo el audio.
    if (s.idioma !== 'auto') s.fijado = s.idioma;
    else if (!s.fijado || final) {
      s.fijado = await core.detectarIdioma(bin, modelo, pcm).catch(() => s.fijado ?? 'es');
      emitir({ tipo: 'idioma', idioma: s.fijado });
    }
    const r = await core.transcribir(bin, { modelo, idioma: s.fijado ?? 'es', rapido: !final }, pcm).catch(() => undefined);
    if (!r) return;
    s.vistas = s.muestras;
    emitir({ tipo: final ? 'final' : 'parcial', texto: r.texto });
  }

  function cerrarSesion(): void {
    if (!sesion) return;
    clearInterval(sesion.tiempo);
    sesion = undefined;
    emitir({ tipo: 'cerrado' });
  }

  ipcMain.handle('dictado:estado', () => {
    const m = motorActual();
    return {
      motor: m.motor,
      disponible: m.motor !== 'ninguno',
      plataforma: process.platform,
      escuchando: Boolean(sesion || apple),
      whisper: { herramienta: Boolean(binWhisper()), modelo: Boolean(modeloWhisper()), archivoModelo: core.MODELO_RECOMENDADO.archivo },
    };
  });

  ipcMain.handle('dictado:iniciar', async (_e, idioma: Idioma = 'auto') => {
    const m = motorActual();
    if (m.motor === 'ninguno') return emitir({ tipo: 'error', codigo: 'sin-ayudante' });
    if (sesion || apple) return;
    if (process.platform === 'darwin') {
      // Hilo pide el micrófono él mismo: así el permiso queda a nombre de la app y lo heredan los ayudantes.
      const ok = await systemPreferences.askForMediaAccess('microphone').catch(() => false);
      if (!ok) return emitir({ tipo: 'error', codigo: 'permiso-microfono' });
    }
    if (m.motor === 'whisper') {
      const s: Sesion = { trozos: [], muestras: 0, vistas: 0, idioma, ocupada: false, cerrando: false, tiempo: setInterval(() => undefined, 1 << 30) };
      clearInterval(s.tiempo);
      s.tiempo = setInterval(() => {
        if (s.ocupada || s.cerrando || s.muestras - s.vistas < 16_000 * 0.6) return;
        s.ocupada = true;
        void pasada(s, false).finally(() => (s.ocupada = false));
      }, 1500);
      sesion = s;
      emitir({ tipo: 'estado', estado: 'escuchando', motor: 'whisper' });
      return;
    }
    const bin = rutaApple()!;
    const lengua = idioma === 'en' ? 'en-US' : 'es-MX';
    const p = spawn(bin, [lengua, '2.2'], { stdio: ['pipe', 'pipe', 'pipe'] });
    apple = p;
    let resto = '';
    p.stdout.on('data', (d: Buffer) => {
      resto += d.toString('utf8');
      const lineas = resto.split('\n');
      resto = lineas.pop() ?? '';
      for (const l of lineas) {
        try {
          const j = JSON.parse(l) as { estado?: string; parcial?: string; final?: string; error?: string };
          if (j.parcial !== undefined) emitir({ tipo: 'parcial', texto: j.parcial });
          else if (j.final !== undefined) emitir({ tipo: 'final', texto: j.final });
          else if (j.estado) emitir({ tipo: 'estado', estado: j.estado, motor: 'apple' });
          else if (j.error) emitir({ tipo: 'error', codigo: j.error });
        } catch {
          /* líneas de aviso del sistema: se ignoran */
        }
      }
    });
    p.on('error', () => emitir({ tipo: 'error', codigo: 'no-arranca' }));
    p.on('close', () => {
      apple = undefined;
      emitir({ tipo: 'cerrado' });
    });
  });

  /** Audio del micrófono ya a 16 kHz, 16 bits y un canal. */
  ipcMain.handle('dictado:audio', (_e, bytes: Uint8Array) => {
    const s = sesion;
    if (!s || s.cerrando) return;
    const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    s.trozos.push(pcm);
    s.muestras += pcm.length;
    if (s.muestras > MAX_SEGUNDOS * 16_000) void detener();
  });

  async function detener(): Promise<void> {
    const s = sesion;
    if (s && !s.cerrando) {
      s.cerrando = true;
      clearInterval(s.tiempo);
      // Si hay un avance en curso se espera; la pasada final usa todo el audio con la mejor calidad.
      for (let i = 0; i < 60 && s.ocupada; i++) await new Promise((r) => setTimeout(r, 100));
      await pasada(s, true).catch(() => emitir({ tipo: 'final', texto: '' }));
      cerrarSesion();
      return;
    }
    const p = apple;
    if (p) {
      p.stdin.write('stop\n');
      setTimeout(() => p.kill(), 4000);
    }
  }
  ipcMain.handle('dictado:detener', () => detener());

  ipcMain.handle('dictado:permisos', (_e, cual: 'microfono' | 'voz') =>
    shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${cual === 'voz' ? 'SpeechRecognition' : 'Microphone'}`),
  );

  /** Descarga el modelo recomendado a los datos de Hilo, con avance. Solo cuando la persona lo pide. */
  ipcMain.handle('dictado:descargar-modelo', async () => {
    const dir = carpetaModelos();
    mkdirSync(dir, { recursive: true });
    const destino = join(dir, core.MODELO_RECOMENDADO.archivo);
    const parte = `${destino}.parte`;
    try {
      const r = await fetch(core.MODELO_RECOMENDADO.url);
      if (!r.ok || !r.body) throw new Error(`El servidor respondió ${r.status}.`);
      const total = Number(r.headers.get('content-length') ?? 0);
      let bajados = 0;
      const lector = Readable.fromWeb(r.body as never);
      lector.on('data', (c: Buffer) => {
        bajados += c.length;
        enviar('dictado:descarga', { bajados, total });
      });
      await pipeline(lector, createWriteStream(parte));
      if (statSync(parte).size < core.MODELO_RECOMENDADO.bytesMinimos) throw new Error('El archivo descargado está incompleto.');
      renameSync(parte, destino);
      enviar('dictado:descarga', { bajados, total, listo: true });
      return { ok: true };
    } catch (e) {
      try {
        unlinkSync(parte);
      } catch {
        /* no había archivo parcial */
      }
      enviar('dictado:descarga', { error: e instanceof Error ? e.message : String(e) });
      return { ok: false };
    }
  });

  app.on('before-quit', () => {
    apple?.kill();
    if (sesion) clearInterval(sesion.tiempo);
  });
}
