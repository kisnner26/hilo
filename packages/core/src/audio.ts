/**
 * Audio del micrófono sin dependencias de Node: lo usa la interfaz (también en el navegador de demostración).
 * Convierte lo que entrega el micrófono al formato que Whisper espera y decide cuándo dejaste de hablar.
 */

/** Pasa audio de cualquier frecuencia a 16 kHz promediando cada tramo (así no se cuelan agudos falsos). */
export function remuestrear(entrada: Float32Array, frecuencia: number, resto = 0): { salida: Int16Array; resto: number } {
  const paso = frecuencia / 16_000;
  const salida: number[] = [];
  let pos = resto;
  while (pos + paso <= entrada.length) {
    const ini = Math.floor(pos);
    const fin = Math.min(entrada.length, Math.max(ini + 1, Math.floor(pos + paso)));
    let s = 0;
    for (let i = ini; i < fin; i++) s += entrada[i]!;
    const v = Math.max(-1, Math.min(1, s / (fin - ini)));
    salida.push(v < 0 ? v * 32768 : v * 32767);
    pos += paso;
  }
  return { salida: Int16Array.from(salida), resto: pos - entrada.length };
}

export const volumenFlotante = (x: Float32Array): number => {
  if (x.length === 0) return 0;
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
};

export interface OpcionesVoz {
  /** Volumen mínimo para considerar que hay voz. */
  umbralMin?: number;
  /** Cuántas veces por encima del ruido de fondo debe estar la voz. */
  factor?: number;
  silencioMs?: number;
  vozMinMs?: number;
  /** Si nunca se oye voz, se rinde después de este tiempo. */
  esperaMs?: number;
  /** Al empezar, este tiempo se usa solo para medir el ruido de fondo. */
  calibracionMs?: number;
}

export interface EstadoVoz {
  hablando: boolean;
  terminar: boolean;
  /** Por qué se terminó. */
  motivo?: 'pausa' | 'nada';
}

/**
 * Detector de voz que se adapta al ruido del cuarto: mide el fondo mientras nadie habla y
 * considera voz lo que lo supera con holgura. Termina tras una pausa larga después de haber hablado.
 */
export class DetectorVoz {
  piso = 0.004;
  private vozMs = 0;
  private silencioMs = 0;
  private totalMs = 0;
  private huboVoz = false;
  private readonly o: Required<OpcionesVoz>;

  constructor(o: OpcionesVoz = {}) {
    this.o = { umbralMin: 0.012, factor: 3, silencioMs: 2000, vozMinMs: 350, esperaMs: 12_000, calibracionMs: 400, ...o };
  }

  procesar(rms: number, ms: number): EstadoVoz {
    this.totalMs += ms;
    if (this.totalMs <= this.o.calibracionMs) {
      // Primer momento: se asume que nadie habla todavía y se aprende el ruido del cuarto.
      this.piso = Math.min(0.05, this.piso * 0.6 + rms * 0.4);
      return { hablando: false, terminar: false };
    }
    const hablando = rms > Math.max(this.o.umbralMin, this.piso * this.o.factor);
    if (hablando) {
      this.vozMs += ms;
      this.silencioMs = 0;
      if (this.vozMs >= this.o.vozMinMs) this.huboVoz = true;
    } else {
      this.silencioMs += ms;
      this.piso = Math.min(0.05, this.piso * 0.95 + rms * 0.05);
    }
    if (this.huboVoz && this.silencioMs >= this.o.silencioMs) return { hablando, terminar: true, motivo: 'pausa' };
    if (!this.huboVoz && this.totalMs >= this.o.esperaMs) return { hablando, terminar: true, motivo: 'nada' };
    return { hablando, terminar: false };
  }
}
