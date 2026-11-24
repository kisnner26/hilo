import { useEffect, useRef, useState } from 'react';
import { api, type UsoVista } from '../lib/api';
import type { ModoNav, PosicionNav } from '../lib/disposicion';

const miles = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)} k` : String(n));
const atajo = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const POSICIONES: { id: PosicionNav; nombre: string }[] = [
  { id: 'izquierda', nombre: 'Izquierda' },
  { id: 'derecha', nombre: 'Derecha' },
  { id: 'arriba', nombre: 'Arriba' },
  { id: 'abajo', nombre: 'Abajo' },
];
const MODOS: { id: ModoNav; nombre: string; ayuda: string }[] = [
  { id: 'completo', nombre: 'Con nombres', ayuda: 'Icono y texto' },
  { id: 'iconos', nombre: 'Solo iconos', ayuda: 'Más compacta' },
  { id: 'oculta', nombre: 'Oculta', ayuda: 'Más espacio' },
];

function Glifo({ pos }: { pos: PosicionNav }) {
  const barra = { izquierda: { x: 3, y: 3, w: 4, h: 14 }, derecha: { x: 17, y: 3, w: 4, h: 14 }, arriba: { x: 3, y: 3, w: 18, h: 4 }, abajo: { x: 3, y: 13, w: 18, h: 4 } }[pos];
  return (
    <svg width="24" height="20" viewBox="0 0 24 20" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="17" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <rect x={barra.x} y={barra.y} width={barra.w} height={barra.h} rx="1.5" fill="currentColor" />
    </svg>
  );
}

interface Props {
  mac: boolean;
  seccion: string;
  pos: PosicionNav;
  modo: ModoNav;
  cambiar: (p: { pos?: PosicionNav; modo?: ModoNav }) => void;
  alternar: () => void;
  abrirPaleta: () => void;
  abrirAhorro: () => void;
  abrirAyuda: () => void;
  /** Versión nueva disponible, si la hay. */
  nuevaVersion?: string;
  abrirActualizar: () => void;
}

/** Barra superior: deja libre el sitio de los tres botones de la ventana y reúne lo que se usa en todas las vistas. */
export function BarraTitulo({ mac, seccion, pos, modo, cambiar, alternar, abrirPaleta, abrirAhorro, abrirAyuda, nuevaVersion, abrirActualizar }: Props) {
  const [menu, setMenu] = useState(false);
  const [uso, setUso] = useState<UsoVista | null>(null);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () => void api.usoResumen().then((u) => vivo && setUso(u)).catch(() => undefined);
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('mousedown', fuera);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', fuera);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const evitados = uso?.tokensEvitados ?? 0;
  return (
    <header className={`barra-titulo${mac ? ' con-semaforo' : ''}`}>
      <button className="bar-boton" onClick={alternar} title={`${modo === 'oculta' ? 'Mostrar' : 'Ocultar'} la navegación (${atajo}+B)`} aria-label="Mostrar u ocultar la navegación">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
          <path d="M9.5 4.5v15" />
        </svg>
      </button>
      <span className="bar-seccion">{seccion}</span>
      <span className="espacio" />
      {nuevaVersion && (
        <button className="bar-actualizar" onClick={abrirActualizar} title="Hay una versión nueva de Hilo. Se actualiza desde aquí, sin ir a GitHub.">
          Actualizar a {nuevaVersion}
        </button>
      )}
      <button className="bar-ahorro" onClick={abrirAhorro} title="Tokens que Hilo evitó mandar en los últimos 30 días. Toca para ver el detalle.">
        <i aria-hidden="true" />
        {evitados > 0 ? (
          <>
            <b>{miles(evitados)}</b> tokens ahorrados
          </>
        ) : (
          'Ahorro de tokens'
        )}
      </button>
      <button className="bar-pregunta" onClick={abrirPaleta} title={`Preguntarle al agente desde cualquier parte (${atajo}+K)`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </svg>
        <span>Preguntar al agente</span>
        <kbd>{atajo} K</kbd>
      </button>
      <div className="bar-menu" ref={caja}>
        <button className={`bar-boton${menu ? ' activo' : ''}`} onClick={() => setMenu(!menu)} title="Cambiar dónde va la navegación" aria-label="Disposición de la navegación" aria-expanded={menu}>
          <Glifo pos={pos} />
        </button>
        {menu && (
          <div className="menu-disposicion vidrio-fuerte" role="dialog" aria-label="Disposición">
            <h4>Dónde va la navegación</h4>
            <div className="posiciones">
              {POSICIONES.map((p) => (
                <button key={p.id} className={pos === p.id ? 'activo' : ''} onClick={() => cambiar({ pos: p.id, ...(modo === 'oculta' ? { modo: 'completo' as const } : {}) })}>
                  <Glifo pos={p.id} />
                  <span>{p.nombre}</span>
                </button>
              ))}
            </div>
            <h4>Cómo se ve</h4>
            <div className="modos">
              {MODOS.map((m) => (
                <button key={m.id} className={modo === m.id ? 'activo' : ''} onClick={() => cambiar({ modo: m.id })}>
                  <b>{m.nombre}</b>
                  <span>{m.ayuda}</span>
                </button>
              ))}
            </div>
            <p className="suave">{atajo}+B la oculta o la muestra. Lo que elijas se recuerda.</p>
            <button className="boton secundario" onClick={() => { setMenu(false); abrirAyuda(); }}>
              Abrir la ayuda
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
