import { describe, expect, it } from 'vitest';
import { DetectorVoz, remuestrear, volumenFlotante } from '../src/audio.js';

const tono = (n: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 5));

describe('remuestreo a 16 kHz', () => {
  it('de 48 kHz da un tercio de las muestras y conserva el nivel', () => {
    const { salida } = remuestrear(new Float32Array(4800).fill(0.5), 48_000);
    expect(salida.length).toBe(1600);
    expect(salida[100]).toBeCloseTo(16383, -1);
  });
  it('no pierde muestras entre bloques sucesivos', () => {
    const a = remuestrear(new Float32Array(1000).fill(0.2), 44_100);
    const b = remuestrear(new Float32Array(1000).fill(0.2), 44_100, a.resto);
    const junto = remuestrear(new Float32Array(2000).fill(0.2), 44_100);
    expect(a.salida.length + b.salida.length).toBeGreaterThanOrEqual(junto.salida.length - 1);
    expect(a.salida.length + b.salida.length).toBeLessThanOrEqual(junto.salida.length + 1);
  });
  it('recorta lo que pasa del rango en vez de desbordar', () => {
    expect(remuestrear(new Float32Array(48).fill(3), 48_000).salida[0]).toBe(32767);
    expect(remuestrear(new Float32Array(48).fill(-3), 48_000).salida[0]).toBe(-32768);
  });
  it('mide el volumen', () => {
    expect(volumenFlotante(new Float32Array(10))).toBe(0);
    expect(volumenFlotante(new Float32Array(10).fill(0.5))).toBeCloseTo(0.5, 5);
  });
});

describe('detector de voz', () => {
  const correr = (d: DetectorVoz, rms: number, ms: number, paso = 100) => {
    let ultimo = { hablando: false, terminar: false } as ReturnType<DetectorVoz['procesar']>;
    for (let t = 0; t < ms && !ultimo.terminar; t += paso) ultimo = d.procesar(rms, paso);
    return ultimo;
  };
  it('termina después de una pausa larga tras haber hablado', () => {
    const d = new DetectorVoz();
    expect(correr(d, 0.002, 500).terminar).toBe(false);
    expect(correr(d, 0.1, 1500).terminar).toBe(false);
    const fin = correr(d, 0.002, 3000);
    expect(fin.terminar).toBe(true);
    expect(fin.motivo).toBe('pausa');
  });
  it('una pausa corta entre frases no corta el dictado', () => {
    const d = new DetectorVoz();
    correr(d, 0.1, 1000);
    expect(correr(d, 0.002, 1200).terminar).toBe(false);
    expect(correr(d, 0.1, 800).terminar).toBe(false);
  });
  it('un ruido muy breve no cuenta como voz', () => {
    const d = new DetectorVoz();
    correr(d, 0.2, 200);
    expect(correr(d, 0.002, 4000).terminar).toBe(false);
  });
  it('se rinde si nadie habla', () => {
    expect(correr(new DetectorVoz(), 0.001, 13_000).motivo).toBe('nada');
  });
  it('en un cuarto ruidoso exige que la voz supere el fondo', () => {
    const d = new DetectorVoz();
    correr(d, 0.02, 1200);
    expect(d.piso).toBeGreaterThan(0.01);
    expect(d.procesar(0.02, 100).hablando).toBe(false);
    expect(d.procesar(0.3, 100).hablando).toBe(true);
  });
  it('el tono de prueba tiene volumen de voz', () => {
    expect(volumenFlotante(tono(1000, 0.3))).toBeGreaterThan(0.1);
  });
});
