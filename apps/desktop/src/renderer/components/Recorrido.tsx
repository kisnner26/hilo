import { useEffect, useLayoutEffect, useState } from 'react';

export interface PasoRecorrido {
  /** Valor de `data-tour` del elemento que se resalta; si no existe, el paso sale centrado. */
  objetivo?: string;
  titulo: string;
  texto: string;
}

interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Recorrido guiado: oscurece la pantalla, resalta un elemento y explica para qué sirve.
 * Solo recorre lo que existe para el rol de la persona.
 */
export function Recorrido({ pasos, alCerrar }: { pasos: PasoRecorrido[]; alCerrar: (completo: boolean) => void }) {
  const [indice, setI] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  // Si la lista de pasos cambia a mitad del recorrido (por ejemplo al conocerse el rol), el índice no se sale de ella.
  const i = Math.min(indice, Math.max(0, pasos.length - 1));
  const paso = pasos[i];

  useLayoutEffect(() => {
    const medir = () => {
      const el = paso?.objetivo ? document.querySelector(`[data-tour="${paso.objetivo}"]`) : null;
      if (!el) return setCaja(null);
      const r = el.getBoundingClientRect();
      setCaja({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [i, paso]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') alCerrar(false);
      if (e.key === 'ArrowRight' || e.key === 'Enter') setI((x) => (x + 1 < pasos.length ? x + 1 : x));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [alCerrar, pasos.length]);

  if (!paso) return null;
  const ultimo = i === pasos.length - 1;
  const tarjeta = caja ? { left: caja.x + caja.w + 18, top: Math.min(Math.max(caja.y - 8, 16), window.innerHeight - 250) } : { left: window.innerWidth / 2 - 190, top: window.innerHeight / 2 - 120 };

  return (
    <div className="recorrido" aria-live="polite">
      {caja ? <div className="foco" style={{ left: caja.x - 6, top: caja.y - 6, width: caja.w + 12, height: caja.h + 12 }} /> : <div className="foco-total" />}
      <div className="globo vidrio-fuerte" style={tarjeta} role="dialog" aria-label={paso.titulo}>
        <p className="contador">
          {i + 1} de {pasos.length}
        </p>
        <h3>{paso.titulo}</h3>
        <p>{paso.texto}</p>
        <div className="puntos">
          {pasos.map((_, k) => (
            <span key={k} className={k === i ? 'activo' : ''} />
          ))}
        </div>
        <div className="botones-globo">
          <button className="enlace-suave" onClick={() => alCerrar(false)}>
            Omitir
          </button>
          <span className="espacio" />
          {i > 0 && (
            <button className="boton secundario" onClick={() => setI(i - 1)}>
              Atrás
            </button>
          )}
          <button className="boton" onClick={() => (ultimo ? alCerrar(true) : setI(i + 1))}>
            {ultimo ? 'Terminar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
