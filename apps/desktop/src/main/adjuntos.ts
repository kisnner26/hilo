import { app, ipcMain, nativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import * as core from '@hilo/core';

const exec = promisify(execFile);

/**
 * Adjuntos del asistente. Cada archivo se lee en tu equipo antes de llegar al agente:
 * las imágenes se reducen o se leen con OCR, los documentos se convierten en texto y solo se manda
 * lo que importa para la pregunta. Así un adjunto cuesta una fracción de lo que costaría tal cual.
 */

const MAX_BYTES = 30 * 1024 * 1024;
export type ModoAdjunto = 'imagen' | 'texto' | 'archivo';

export interface AdjuntoInfo {
  id: string;
  nombre: string;
  tipo: core.TipoAdjunto;
  formato: string;
  bytes: number;
  ancho?: number;
  alto?: number;
  ruta: string;
  rutaImagen?: string;
  /** Texto completo extraído, solo en el proceso principal. */
  texto?: string;
  metodo: string;
  modo: ModoAdjunto;
  /** Lo que costaría mandarlo tal cual y lo que cuesta como se manda. */
  tokensOriginal: number;
  tokensEnviados: number;
  /** Modos entre los que se puede elegir. */
  modos: ModoAdjunto[];
  aviso?: string;
  vista?: string;
}

const preparados = new Map<string, AdjuntoInfo>();
const carpeta = () => {
  const d = join(app.getPath('userData'), 'adjuntos');
  mkdirSync(d, { recursive: true });
  return d;
};

const rutaAyudante = (nombre: string): string | undefined => {
  const r = app.isPackaged ? join(process.resourcesPath, 'native', nombre) : resolve(__dirname, `../../native/bin/${nombre}`);
  return process.platform === 'darwin' && existsSync(r) ? r : undefined;
};

async function leerConAyudante(modo: 'imagen' | 'pdf', ruta: string): Promise<{ texto: string; paginas: number } | undefined> {
  const bin = rutaAyudante('hilo-ocr');
  if (!bin) return undefined;
  try {
    const { stdout } = await exec(bin, [modo, ruta], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    const j = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { texto?: string; paginas?: number };
    return j.texto !== undefined ? { texto: j.texto, paginas: j.paginas ?? 1 } : undefined;
  } catch {
    return undefined;
  }
}

async function pdfConPoppler(ruta: string): Promise<string | undefined> {
  const bin = core.buscar('pdftotext');
  if (!bin) return undefined;
  try {
    return (await exec(bin, ['-layout', '-q', ruta, '-'], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
  } catch {
    return undefined;
  }
}

const nombreSeguro = (n: string) => n.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-80) || 'archivo';

export function registrarAdjuntos(d: { ahorro(): core.AjustesAhorro }) {
  const presupuestoTexto = () => {
    const a = d.ahorro();
    return a.activo ? (a.presupuesto <= 800 ? 1500 : 3000) : 12_000;
  };
  const ladoMax = () => {
    const a = d.ahorro();
    return a.activo ? (a.presupuesto <= 800 ? 768 : 1280) : 1568;
  };

  const tokensEnviadosDe = (a: AdjuntoInfo): number => {
    if (a.modo === 'imagen') {
      if (!a.ancho || !a.alto) return 0;
      const plan = core.planDeImagen(a.ancho, a.alto, ladoMax());
      return core.tokensDeImagen(plan.ancho, plan.alto);
    }
    if (a.modo === 'texto') return Math.min(core.estimarTokens(a.texto ?? ''), presupuestoTexto());
    return 200;
  };

  async function preparar(nombre: string, bytes: Uint8Array): Promise<AdjuntoInfo> {
    if (bytes.byteLength > MAX_BYTES) throw new Error(`«${nombre}» pesa ${Math.round(bytes.byteLength / 1e6)} MB: el máximo es ${MAX_BYTES / 1024 / 1024} MB.`);
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const id = createHash('sha1').update(buf).digest('hex').slice(0, 10);
    const previo = preparados.get(id);
    if (previo) return previo;
    const { tipo, formato } = core.clasificar(nombre, buf.subarray(0, 4096));
    const ruta = join(carpeta(), `${id}-${nombreSeguro(nombre)}`);
    writeFileSync(ruta, buf);
    const a: AdjuntoInfo = { id, nombre, tipo, formato, bytes: buf.length, ruta, metodo: '', modo: 'archivo', tokensOriginal: 0, tokensEnviados: 0, modos: ['archivo'] };

    if (tipo === 'imagen') {
      const img = nativeImage.createFromBuffer(buf);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        a.ancho = width;
        a.alto = height;
        a.tokensOriginal = core.tokensDeImagen(width, height);
        const plan = core.planDeImagen(width, height, ladoMax());
        const soportada = ['png', 'jpg', 'gif', 'webp'].includes(formato);
        if (plan.reducir || !soportada) {
          const chica = img.resize({ width: plan.ancho, height: plan.alto, quality: 'best' });
          const png = formato === 'png' || !soportada;
          a.rutaImagen = join(carpeta(), `${id}-reducida.${png ? 'png' : 'jpg'}`);
          writeFileSync(a.rutaImagen, png ? chica.toPNG() : chica.toJPEG(82));
        } else a.rutaImagen = ruta;
        a.vista = img.resize({ width: 120, quality: 'good' }).toDataURL();
        const ocr = await leerConAyudante('imagen', ruta);
        if (ocr?.texto) a.texto = ocr.texto;
        a.modos = a.texto ? ['imagen', 'texto'] : ['imagen'];
        a.modo = a.texto && core.esImagenDeTexto(a.texto) ? 'texto' : 'imagen';
        a.metodo = a.modo === 'texto' ? 'texto leído en tu equipo' : plan.reducir ? `reducida a ${plan.ancho}×${plan.alto}` : 'imagen original';
      } else {
        a.aviso = 'No pude abrir esta imagen; se manda como archivo.';
      }
    } else if (tipo === 'pdf') {
      const r = await leerConAyudante('pdf', ruta);
      const texto = r?.texto ?? (await pdfConPoppler(ruta)) ?? '';
      a.tokensOriginal = Math.max(core.estimarTokens(texto), (r?.paginas ?? 1) * 1500);
      if (texto.trim().length >= 80) {
        a.texto = texto;
        a.modos = ['texto', 'archivo'];
        a.modo = 'texto';
        a.metodo = `texto de ${r?.paginas ?? '?'} página${r?.paginas === 1 ? '' : 's'}, leído en tu equipo`;
      } else {
        a.aviso = 'No pude sacarle texto; el agente lo lee directamente.';
        a.metodo = 'PDF para leer directo';
      }
    } else {
      const t = core.extraerTexto(nombre, tipo, formato, buf);
      if (t) {
        a.texto = t.texto;
        a.modo = 'texto';
        a.modos = ['texto'];
        a.metodo = t.metodo;
        a.tokensOriginal = core.estimarTokens(tipo === 'datos' ? buf.toString('utf8') : t.texto);
      } else a.aviso = 'No pude leer este formato; el agente puede intentarlo por su cuenta.';
    }
    a.tokensEnviados = tokensEnviadosDe(a);
    if (a.tokensOriginal === 0) a.tokensOriginal = a.tokensEnviados;
    preparados.set(id, a);
    return a;
  }

  const publico = (a: AdjuntoInfo) => {
    const { texto, ...resto } = a;
    return { ...resto, caracteres: texto?.length ?? 0 };
  };

  ipcMain.handle('adjuntos:preparar', async (_e, nombre: string, bytes: Uint8Array) => publico(await preparar(nombre, bytes)));
  ipcMain.handle('adjuntos:modo', (_e, id: string, modo: ModoAdjunto) => {
    const a = preparados.get(id);
    if (!a || !a.modos.includes(modo)) return undefined;
    a.modo = modo;
    a.tokensEnviados = tokensEnviadosDe(a);
    return publico(a);
  });

  /** El bloque de texto que se antepone a la pregunta, las imágenes para Codex y lo que se ahorró. */
  function bloque(ids: string[], pregunta: string, motor: core.MotorId): { texto: string; imagenes: string[]; carpetas: string[]; antes: number; despues: number; nombres: string[] } {
    const lista = ids.map((i) => preparados.get(i)).filter((x): x is AdjuntoInfo => Boolean(x));
    const veImagenes = core.esAgente(motor);
    const partes: string[] = [];
    const imagenes: string[] = [];
    let antes = 0;
    let despues = 0;
    for (const a of lista) {
      antes += a.tokensOriginal;
      if (a.modo === 'imagen' && a.rutaImagen) {
        if (veImagenes) {
          imagenes.push(a.rutaImagen);
          partes.push(`- Imagen adjunta «${a.nombre}» (${a.ancho}×${a.alto}): léela con tu herramienta Read en ${a.rutaImagen}.`);
          despues += a.tokensEnviados;
        } else if (a.texto) {
          partes.push(`## Imagen «${a.nombre}» (este motor no ve imágenes; texto leído en tu equipo)\n${core.podarTexto(a.texto, pregunta, presupuestoTexto())}`);
          despues += Math.min(core.estimarTokens(a.texto), presupuestoTexto());
        } else partes.push(`- Imagen «${a.nombre}»: este motor no puede verla y no tiene texto. Conecta Claude Code o Codex para analizarla.`);
      } else if (a.modo === 'texto' && a.texto) {
        const poda = core.podarTexto(a.texto, pregunta, presupuestoTexto());
        partes.push(`## Adjunto «${a.nombre}» (${a.metodo})\n${poda}${poda.length < a.texto.length && veImagenes ? `\n(Archivo original completo: ${a.ruta}; léelo si necesitas más.)` : ''}`);
        despues += core.estimarTokens(poda);
      } else {
        partes.push(`- Archivo «${a.nombre}» (${a.formato}, ${a.bytes.toLocaleString('es')} bytes): ${veImagenes ? `léelo con tu herramienta Read en ${a.ruta}.` : 'este motor no puede abrirlo.'}`);
        despues += a.tokensEnviados;
      }
    }
    return { texto: partes.length ? `[Adjuntos de la persona]\n${partes.join('\n\n')}` : '', imagenes, carpetas: lista.length ? [carpeta()] : [], antes, despues, nombres: lista.map((x) => x.nombre) };
  }

  return { bloque, carpeta, leerTexto: (id: string) => preparados.get(id)?.texto };
}

