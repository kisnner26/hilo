import { DetectorVoz, remuestrear, volumenFlotante } from '@hilo/core/audio';

export interface NivelVoz {
  /** Volumen de 0 a 1 para dibujar el micrófono. */
  nivel: number;
  hablando: boolean;
}

/**
 * Captura el micrófono, lo pasa a 16 kHz y 16 bits y lo entrega en trozos. Avisa cuando dejaste de hablar.
 * Usa limpieza de eco y de ruido del propio sistema, que ayuda mucho a que Whisper entienda mejor.
 */
export class Captura {
  private flujo?: MediaStream;
  private ctx?: AudioContext;
  private proc?: ScriptProcessorNode;
  private resto = 0;
  private activo = false;
  private detector = new DetectorVoz();

  constructor(
    private alAudio: (pcm: Uint8Array) => void,
    private alNivel: (n: NivelVoz) => void,
    private alTerminar: (motivo: 'pausa' | 'nada') => void,
  ) {}

  async iniciar(): Promise<void> {
    this.flujo = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    const fuente = this.ctx.createMediaStreamSource(this.flujo);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.activo = true;
    this.detector = new DetectorVoz();
    const frecuencia = this.ctx.sampleRate;
    let ultimoNivel = 0;
    this.proc.onaudioprocess = (e) => {
      if (!this.activo) return;
      const x = e.inputBuffer.getChannelData(0);
      const r = remuestrear(x, frecuencia, this.resto);
      this.resto = r.resto;
      if (r.salida.length > 0) this.alAudio(new Uint8Array(r.salida.buffer, r.salida.byteOffset, r.salida.byteLength));
      const ms = (x.length / frecuencia) * 1000;
      const rms = volumenFlotante(x);
      const est = this.detector.procesar(rms, ms);
      const ahora = performance.now();
      if (ahora - ultimoNivel > 80) {
        ultimoNivel = ahora;
        this.alNivel({ nivel: Math.min(1, rms * 6), hablando: est.hablando });
      }
      if (est.terminar && est.motivo) {
        this.activo = false;
        this.alTerminar(est.motivo);
      }
    };
    fuente.connect(this.proc);
    // El procesador debe estar conectado a la salida para que corra; el volumen de salida es cero.
    const mudo = this.ctx.createGain();
    mudo.gain.value = 0;
    this.proc.connect(mudo);
    mudo.connect(this.ctx.destination);
  }

  detener(): void {
    this.activo = false;
    this.proc?.disconnect();
    this.flujo?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.proc = undefined;
    this.flujo = undefined;
    this.ctx = undefined;
    this.resto = 0;
  }
}
