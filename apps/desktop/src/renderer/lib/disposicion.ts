import { useCallback, useEffect, useState } from 'react';

export type PosicionNav = 'izquierda' | 'derecha' | 'arriba' | 'abajo';
export type ModoNav = 'completo' | 'iconos' | 'oculta';
export interface Disposicion {
  pos: PosicionNav;
  modo: ModoNav;
}

const CLAVE = 'hilo.disposicion';
const BASE: Disposicion = { pos: 'izquierda', modo: 'completo' };

function leer(): Disposicion {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE) ?? '{}') as Partial<Disposicion>;
    return { pos: (['izquierda', 'derecha', 'arriba', 'abajo'] as const).includes(d.pos as PosicionNav) ? d.pos! : BASE.pos, modo: (['completo', 'iconos', 'oculta'] as const).includes(d.modo as ModoNav) ? d.modo! : BASE.modo };
  } catch {
    return BASE;
  }
}

/** Dónde va la navegación y cómo se ve; se recuerda entre sesiones. */
export function useDisposicion() {
  const [d, setD] = useState<Disposicion>(leer);
  const cambiar = useCallback((p: Partial<Disposicion>) => {
    setD((a) => {
      const n = { ...a, ...p };
      try {
        localStorage.setItem(CLAVE, JSON.stringify(n));
      } catch {
        /* sin almacenamiento: vale solo en esta sesión */
      }
      return n;
    });
  }, []);
  /** Alterna entre oculta y el último estilo visible. */
  const alternar = useCallback(() => setD((a) => {
    const n: Disposicion = { ...a, modo: a.modo === 'oculta' ? 'completo' : 'oculta' };
    try {
      localStorage.setItem(CLAVE, JSON.stringify(n));
    } catch {
      /* sin almacenamiento */
    }
    return n;
  }), []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        alternar();
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [alternar]);
  return { ...d, cambiar, alternar };
}
