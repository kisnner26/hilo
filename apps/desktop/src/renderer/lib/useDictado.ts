import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type EstadoDictado, type IdiomaVoz } from './api';
import { Captura } from './microfono';

export type FaseDictado = 'inactivo' | 'iniciando' | 'escuchando' | 'cerrando';

export const MENSAJE_ERROR: Record<string, string> = {
  'permiso-microfono': 'Hilo no tiene permiso para usar el micrófono.',
  'permiso-voz': 'Hilo no tiene permiso para el reconocimiento de voz.',
  'idioma-no-disponible': 'Tu sistema no tiene reconocimiento de voz en este idioma.',
  'reconocedor-no-disponible': 'El reconocimiento de voz no está disponible ahora. Prueba en un momento.',
  'microfono-ocupado': 'El micrófono lo está usando otra aplicación.',
  'no-arranca': 'No se pudo iniciar el dictado.',
  'sin-ayudante': 'Esta versión de Hilo no trae el dictado por voz.',
  'sin-microfono': 'No se encontró un micrófono o no diste permiso en el sistema.',
};

const CLAVE_IDIOMA = 'hilo.voz-idioma';
const idiomaGuardado = (): IdiomaVoz => {
  try {
    const v = localStorage.getItem(CLAVE_IDIOMA);
    return v === 'es' || v === 'en' ? v : 'auto';
  } catch {
    return 'auto';
  }
};

/**
 * Dictado por voz: el texto llega a medida que hablas y, al terminar, entrega lo dicho.
 * `alTexto` recibe cada avance (final = false) y el texto definitivo (final = true).
 */
export function useDictado(alTexto: (texto: string, final: boolean) => void) {
  const [estado, setEstado] = useState<EstadoDictado | null>(null);
  const [fase, setFase] = useState<FaseDictado>('inactivo');
  const [error, setError] = useState('');
  const [nivel, setNivel] = useState(0);
  const [idioma, setIdiomaEstado] = useState<IdiomaVoz>(idiomaGuardado);
  const [detectado, setDetectado] = useState('');
  const cb = useRef(alTexto);
  cb.current = alTexto;
  const faseRef = useRef(fase);
  faseRef.current = fase;
  const captura = useRef<Captura | null>(null);

  const refrescar = useCallback(() => void api.dictadoEstado().then(setEstado), []);
  useEffect(refrescar, [refrescar]);

  const parar = useCallback(() => {
    captura.current?.detener();
    captura.current = null;
    setNivel(0);
  }, []);

  useEffect(
    () =>
      api.alDictado((e) => {
        if (e.tipo === 'estado' && e.estado === 'escuchando') setFase('escuchando');
        if (e.tipo === 'idioma') setDetectado(e.idioma ?? '');
        if (e.tipo === 'parcial') cb.current(e.texto ?? '', false);
        if (e.tipo === 'final') cb.current(e.texto ?? '', true);
        if (e.tipo === 'error') {
          parar();
          setError(e.codigo ?? 'no-arranca');
          setFase('inactivo');
        }
        if (e.tipo === 'cerrado') {
          parar();
          setFase('inactivo');
        }
      }),
    [parar],
  );
  useEffect(() => parar, [parar]);

  const detener = useCallback(() => {
    if (faseRef.current === 'inactivo') return;
    setFase('cerrando');
    parar();
    void api.dictadoDetener();
  }, [parar]);

  const iniciar = useCallback(async () => {
    if (faseRef.current !== 'inactivo') return;
    setError('');
    setDetectado('');
    setFase('iniciando');
    const est = await api.dictadoEstado();
    setEstado(est);
    await api.dictadoIniciar(idioma);
    if (est.motor !== 'whisper') return;
    // Con Whisper la captura la hace la interfaz y el audio va al proceso principal.
    const c = new Captura(
      (pcm) => void api.dictadoAudio(pcm),
      (n) => setNivel(n.nivel),
      () => detener(),
    );
    captura.current = c;
    try {
      await c.iniciar();
    } catch {
      parar();
      setError('sin-microfono');
      setFase('inactivo');
      void api.dictadoDetener();
    }
  }, [idioma, detener, parar]);

  const alternar = useCallback(() => (faseRef.current === 'inactivo' ? void iniciar() : detener()), [iniciar, detener]);
  const cambiarIdioma = (i: IdiomaVoz) => {
    setIdiomaEstado(i);
    try {
      localStorage.setItem(CLAVE_IDIOMA, i);
    } catch {
      /* sin almacenamiento */
    }
  };

  return {
    disponible: Boolean(estado?.disponible),
    motor: estado?.motor ?? 'ninguno',
    plataforma: estado?.plataforma ?? '',
    estado,
    refrescar,
    fase,
    error,
    nivel,
    idioma,
    cambiarIdioma,
    detectado,
    limpiarError: () => setError(''),
    iniciar,
    detener,
    alternar,
  };
}
