import { useEffect, useMemo, useRef, useState } from 'react';
import { buscarNodos, puntosClave } from '@hilo/core/analisis-grafo';
import { fijarGrafo, useGrafo } from '../lib/grafoDatos';
import { AJUSTES_POR_DEFECTO, Galaxia, PALETA, type Ajustes, type NodoVista } from '../lib/galaxy';
import { api } from '../lib/api';

interface Props {
  alElegir: (n: NodoVista | null) => void;
  elegido: NodoVista | null;
  recargar: number;
  /** Cada vez que sube, la cámara enfoca el nodo elegido (viene de la búsqueda o del inspector). */
  enfocar: number;
}

const CLAVE = 'hilo.ajustes-grafo';

function ajustesGuardados(): Ajustes {
  try {
    return { ...AJUSTES_POR_DEFECTO, ...(JSON.parse(localStorage.getItem(CLAVE) ?? '{}') as Partial<Ajustes>) };
  } catch {
    return { ...AJUSTES_POR_DEFECTO };
  }
}

type Deslizable = { clave: keyof Ajustes; nombre: string; min: number; max: number; paso: number; dec: number };
const DESLIZABLES: Deslizable[] = [
  { clave: 'brillo', nombre: 'Brillo', min: 0, max: 3, paso: 0.05, dec: 2 },
  { clave: 'tamBrillo', nombre: 'Tamaño del brillo', min: 0, max: 2, paso: 0.05, dec: 2 },
  { clave: 'tamNodo', nombre: 'Tamaño de nodo', min: 0.05, max: 1, paso: 0.05, dec: 2 },
  { clave: 'enlaces', nombre: 'Enlaces', min: 0, max: 2, paso: 0.05, dec: 2 },
  { clave: 'anillos', nombre: 'Anillos', min: 0, max: 1, paso: 0.01, dec: 2 },
  { clave: 'perlas', nombre: 'Perlas de luz', min: 0, max: 1500, paso: 50, dec: 0 },
  { clave: 'velPerlas', nombre: 'Velocidad', min: 0, max: 8, paso: 0.25, dec: 2 },
  { clave: 'giro', nombre: 'Giro', min: 0, max: 4, paso: 0.1, dec: 2 },
];
type Interruptor = { clave: keyof Ajustes; nombre: string };
const INTERRUPTORES: Interruptor[] = [
  { clave: 'cometas', nombre: 'Cometas' },
  { clave: 'pulso', nombre: 'Pulso' },
  { clave: 'estrellas', nombre: 'Estrellas' },
  { clave: 'nombres', nombre: 'Nombres de carpeta' },
  { clave: 'ahorrarGpu', nombre: 'Ahorrar GPU en segundo plano' },
];

export function GraphView({ alElegir, elegido, recargar, enfocar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const etiquetas = useRef<HTMLDivElement>(null);
  const galaxia = useRef<Galaxia | null>(null);
  const [ajustes, setAjustes] = useState<Ajustes>(ajustesGuardados);
  const [panel, setPanel] = useState(false);
  const [fps, setFps] = useState(0);
  const [tip, setTip] = useState<{ n: NodoVista; x: number; y: number } | null>(null);
  const [totales, setTotales] = useState({ nodos: 0, enlaces: 0, notas: 0 });
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [guia, setGuia] = useState(() => {
    try {
      return localStorage.getItem('hilo.grafo-guia') !== 'cerrada';
    } catch {
      return true;
    }
  });
  const grafo = useGrafo();
  const resultados = useMemo(() => buscarNodos(grafo, busca, 6), [grafo, busca]);
  const clave = useMemo(() => puntosClave(grafo, 6), [grafo]);

  useEffect(() => {
    const g = new Galaxia(contenedor.current!, etiquetas.current!);
    g.aplicarAjustes(ajustes);
    g.alFps = setFps;
    g.alPasar = (n, x, y) => setTip(n ? { n, x, y } : null);
    g.alElegir = alElegir;
    galaxia.current = g;
    const tecla = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) g.enfocar();
    };
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('keydown', tecla);
      g.destruir();
      galaxia.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let vivo = true;
    api
      .grafo()
      .then((d) => {
        if (!vivo) return;
        galaxia.current?.cargar(d.nodos, d.enlaces);
        fijarGrafo({ nodos: d.nodos, enlaces: d.enlaces });
        setTotales({ nodos: d.nodos.length, enlaces: d.enlaces.length, notas: d.notas });
        setError(d.nodos.length === 0 ? 'Todavía no hay grafo. Abre uno en Ajustes.' : '');
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      vivo = false;
    };
  }, [recargar]);

  useEffect(() => {
    galaxia.current?.elegir(elegido?.id ?? null);
  }, [elegido]);
  useEffect(() => {
    if (enfocar > 0) galaxia.current?.enfocar();
  }, [enfocar]);

  const irA = (id: string) => {
    const n = grafo.nodos.find((x) => x.id === id);
    if (n) alElegir(n as NodoVista);
    setBusca('');
  };
  const cerrarGuia = () => {
    setGuia(false);
    try {
      localStorage.setItem('hilo.grafo-guia', 'cerrada');
    } catch {
      /* sin almacenamiento */
    }
  };

  const cambiar = (p: Partial<Ajustes>) => {
    const nuevo = { ...ajustes, ...p };
    setAjustes(nuevo);
    galaxia.current?.aplicarAjustes(p);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(nuevo));
    } catch {
      /* sin almacenamiento: los ajustes valen solo en esta sesión */
    }
  };

  return (
    <div className="vista-grafo">
      <div className="lienzo" ref={contenedor} />
      <div className="etiquetas-carpeta" ref={etiquetas} />

      <div className="buscar-grafo">
        <input placeholder="Buscar un archivo o concepto…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar en el grafo" />
        {resultados.length > 0 && (
          <ul>
            {resultados.map((n) => (
              <li key={n.id}>
                <button onClick={() => irA(n.id)}>
                  <b>{n.label}</b>
                  <span>{n.nombreComunidad}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="acciones-grafo">
        <button className="pastilla" onClick={() => galaxia.current?.reiniciarVista()}>
          Restablecer vista
        </button>
        <button className="pastilla" onClick={() => galaxia.current?.enfocar()}>
          Enfocar (F)
        </button>
        <button className={`pastilla${ajustes.plano ? ' activa' : ''}`} onClick={() => cambiar({ plano: !ajustes.plano })}>
          {ajustes.plano ? 'Plano' : 'Galaxia'}
        </button>
        <button className={`pastilla${panel ? ' activa' : ''}`} onClick={() => setPanel(!panel)}>
          Personalizar
        </button>
      </div>

      {panel && (
        <div className="panel-personalizar">
          <h3>Personalizar</h3>
          <div className="fila-ajuste">
            <span>Color</span>
            <span className="colores">
              {PALETA.map((c) => (
                <button key={c} className={`color${ajustes.color === c ? ' elegido' : ''}`} style={{ background: c }} onClick={() => cambiar({ color: c })} aria-label={`Color ${c}`} />
              ))}
            </span>
          </div>
          {DESLIZABLES.map((d) => (
            <div className="fila-ajuste" key={d.clave}>
              <span>{d.nombre}</span>
              <input type="range" min={d.min} max={d.max} step={d.paso} value={ajustes[d.clave] as number} onChange={(e) => cambiar({ [d.clave]: Number(e.target.value) })} />
              <span className="valor">{(ajustes[d.clave] as number).toFixed(d.dec)}</span>
            </div>
          ))}
          {INTERRUPTORES.map((i) => (
            <div className="fila-ajuste" key={i.clave}>
              <span>{i.nombre}</span>
              <button className={`interruptor${ajustes[i.clave] ? ' si' : ''}`} onClick={() => cambiar({ [i.clave]: !ajustes[i.clave] })}>
                {ajustes[i.clave] ? 'Sí' : 'No'}
              </button>
            </div>
          ))}
          <div className="fila-ajuste">
            <span>Calidad</span>
            <span className="segmentos">
              {(['rapida', 'alta', 'maxima'] as const).map((q) => (
                <button key={q} className={ajustes.calidad === q ? 'si' : ''} onClick={() => cambiar({ calidad: q })}>
                  {q === 'rapida' ? 'Rápida' : q === 'alta' ? 'Alta' : 'Máxima'}
                </button>
              ))}
            </span>
          </div>
          <button className="restablecer" onClick={() => cambiar({ ...AJUSTES_POR_DEFECTO })}>
            Valores por defecto
          </button>
        </div>
      )}

      {!elegido && guia && clave.length > 0 && (
        <div className="guia-grafo vidrio">
          <header>
            <b>Cómo leer este mapa</b>
            <button className="cerrar" onClick={cerrarGuia} aria-label="Cerrar la guía">
              ×
            </button>
          </header>
          <p className="suave">Cada punto es un archivo, nota o concepto del proyecto. Las líneas son relaciones: «usa», «importa», «menciona». Elige uno y verás qué usa, qué lo usa y qué se rompería si lo cambias. Así le pasas al agente solo lo necesario.</p>
          <h4>Por dónde empezar</h4>
          <ul>
            {clave.map((c) => (
              <li key={c.nodo.id}>
                <button className="enlace-nodo" onClick={() => irA(c.nodo.id)}>
                  {c.nodo.label}
                </button>
                <span className="dist">{c.conexiones} lo usan</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tip && (
        <div className="tarjeta-nodo" style={{ left: Math.min(tip.x + 14, (contenedor.current?.clientWidth ?? 800) - 230), top: tip.y + 12 }}>
          <strong>{tip.n.label}</strong>
          <span>{tip.n.nombreComunidad}</span>
        </div>
      )}

      {error && <div className="vacio-grafo">{error}</div>}

      <div className="estado-grafo">
        <span>{fps} fps</span>
        <span>
          {totales.nodos.toLocaleString('es')} nodos · {totales.enlaces.toLocaleString('es')} enlaces{totales.notas > 0 ? ` · ${totales.notas} notas` : ''}
        </span>
      </div>
      <div className="ayuda-grafo">Arrastra para girar · rueda para acercar · F para enfocar · busca arriba por nombre</div>
    </div>
  );
}
