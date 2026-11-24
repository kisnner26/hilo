import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type EstadoDictado } from './api';

export type FaseDictado = 'inactivo' | 'iniciando' | 'escuchando' | 'cerrando';

export const MENSAJE_ERROR: Record<string, string> = {
  'permiso-microfono': 'Hilo no tiene permiso para usar el micrófono.',
  'permiso-voz': 'Hilo no tiene permiso para el reconocimiento de voz.',
  'idioma-no-disponible': 'Tu sistema no tiene reconocimiento de voz en este idioma.',
  'reconocedor-no-disponible': 'El reconocimiento de voz no está disponible ahora. Prueba en un momento.',
  'microfono-ocupado': 'El micrófono lo está usando otra aplicación.',
  'no-arranca': 'No se pudo iniciar el dictado.',
  'sin-ayudante': 'Esta versión de Hilo no trae el dictado por voz.',
};

/**
 * Dictado por voz: el texto llega a medida que hablas y, al terminar, entrega lo dicho.
 * `alTexto` recibe cada parcial (final = false) y el texto definitivo (final = true).
 */
export function useDictado(alTexto: (texto: string, final: boolean) => void) {
  const [estado, setEstado] = useState<EstadoDictado | null>(null);
  const [fase, setFase] = useState<FaseDictado>('inactivo');
  const [error, setError] = useState('');
  const cb = useRef(alTexto);
  cb.current = alTexto;
  const faseRef = useRef(fase);
  faseRef.current = fase;

  useEffect(() => void api.dictadoEstado().then(setEstado), []);
  useEffect(
    () =>
      api.alDictado((e) => {
        if (e.tipo === 'estado' && e.estado === 'escuchando') setFase('escuchando');
        if (e.tipo === 'parcial') cb.current(e.texto ?? '', false);
        if (e.tipo === 'final') cb.current(e.texto ?? '', true);
        if (e.tipo === 'error') {
          setError(e.codigo ?? 'no-arranca');
          setFase('inactivo');
        }
        if (e.tipo === 'cerrado') setFase('inactivo');
      }),
    [],
  );

  const iniciar = useCallback(() => {
    if (faseRef.current !== 'inactivo') return;
    setError('');
    setFase('iniciando');
    void api.dictadoIniciar(navigator.language || 'es-MX');
  }, []);
  const detener = useCallback(() => {
    if (faseRef.current === 'inactivo') return;
    setFase('cerrando');
    void api.dictadoDetener();
  }, []);
  const alternar = useCallback(() => (faseRef.current === 'inactivo' ? iniciar() : detener()), [iniciar, detener]);

  return { disponible: Boolean(estado?.disponible), plataforma: estado?.plataforma ?? '', fase, error, limpiarError: () => setError(''), iniciar, detener, alternar };
}
