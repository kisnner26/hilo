import { useEffect, useState, type ReactNode } from 'react';
import { GraphView } from './components/GraphView';
import { Inicio } from './components/Inicio';
import { Tablero } from './components/Tablero';
import { AgentesPanel, AjustesPanel, HilosPanel, NotasPanel, RevisarPanel } from './components/Panels';
import { api, type PerfilVista } from './lib/api';
import type { NodoVista } from './lib/galaxy';

type Vista = 'inicio' | 'tablero' | 'grafo' | 'notas' | 'revisar' | 'agentes' | 'hilos' | 'ajustes';

const Icono = ({ d }: { d: ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const SECCIONES: { id: Vista; nombre: string; icono: ReactNode }[] = [
  { id: 'inicio', nombre: 'Mi día', icono: <Icono d={<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>} /> },
  { id: 'tablero', nombre: 'Tablero', icono: <Icono d={<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 4v16M15 4v10" /></>} /> },
  { id: 'grafo', nombre: 'Grafo', icono: <Icono d={<><circle cx="6" cy="7" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="12" cy="17" r="2.2" /><path d="M8 8l3 7M16.2 7.7L13 15M8.2 7h7.6" /></>} /> },
  { id: 'notas', nombre: 'Notas', icono: <Icono d={<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>} /> },
  { id: 'revisar', nombre: 'Revisar PR', icono: <Icono d={<><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 8v8M18 10v3a4 4 0 01-4 4h-3.5" /></>} /> },
  { id: 'agentes', nombre: 'Agentes', icono: <Icono d={<><rect x="5" y="8" width="14" height="10" rx="3" /><path d="M12 8V5M9.5 13h.01M14.5 13h.01M9 21h6" /></>} /> },
  { id: 'hilos', nombre: 'Hilos', icono: <Icono d={<><path d="M4 7c4-4 6 4 10 0s5-3 6-1M4 13c4-4 6 4 10 0s5-3 6-1M4 19c4-4 6 4 10 0s5-3 6-1" /></>} /> },
  { id: 'ajustes', nombre: 'Ajustes', icono: <Icono d={<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>} /> },
];

function Inspector({ nodo, cerrar }: { nodo: NodoVista; cerrar: () => void }) {
  const [info, setInfo] = useState<{ tokens: number; nodos: number } | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    setInfo(null);
    setCopiado(false);
    void api.contexto({ alcance: { tipo: 'vecindad', nodo: nodo.id, saltos: 2 }, conciso: true, sinRuido: true }).then((p) => setInfo({ tokens: p.tokens, nodos: p.nodos ?? 0 }));
  }, [nodo]);
  return (
    <aside className="inspector">
      <header>
        <strong>{nodo.label}</strong>
        <button className="cerrar" onClick={cerrar} aria-label="Cerrar">
          ×
        </button>
      </header>
      <dl>
        <dt>Carpeta</dt>
        <dd>{nodo.nombreComunidad}</dd>
        {nodo.archivo && (
          <>
            <dt>Archivo</dt>
            <dd className="mono">{nodo.archivo}</dd>
          </>
        )}
        {nodo.tipo && (
          <>
            <dt>Tipo</dt>
            <dd>{nodo.tipo}</dd>
          </>
        )}
      </dl>
      <button
        className="boton"
        onClick={async () => {
          const p = await api.contexto({ alcance: { tipo: 'vecindad', nodo: nodo.id, saltos: 2 }, conciso: true, sinRuido: true });
          await api.copiar(p.texto);
          setCopiado(true);
        }}
      >
        {copiado ? 'Copiado' : 'Copiar contexto de la vecindad'}
      </button>
      {info && (
        <p className="suave">
          ~{info.tokens.toLocaleString('es')} tokens · {info.nodos} nodos. Solo lo cercano a este nodo, no todo el proyecto.
        </p>
      )}
    </aside>
  );
}

export function App() {
  const [vista, setVista] = useState<Vista>('inicio');
  const [prARevisar, setPrARevisar] = useState('');
  const [nodo, setNodo] = useState<NodoVista | null>(null);
  const [perfil, setPerfil] = useState<PerfilVista | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => void api.perfil().then(setPerfil), [recarga]);
  return (
    <div className="aplicacion">
      <div className="barra-titulo" />
      <nav className="riel">
        {SECCIONES.map((s) => (
          <button key={s.id} className={`riel-boton${vista === s.id ? ' activo' : ''}`} onClick={() => setVista(s.id)} title={s.nombre} aria-label={s.nombre}>
            {s.icono}
            <span>{s.nombre}</span>
          </button>
        ))}
      </nav>
      <main className="principal">
        <div className={vista === 'grafo' ? 'ocupa' : 'oculta'}>
          <GraphView
            elegido={nodo}
            recargar={recarga}
            alElegir={(n) => {
              setNodo(n);
            }}
          />
          {nodo && <Inspector nodo={nodo} cerrar={() => setNodo(null)} />}
        </div>
        {vista === 'notas' && <NotasPanel nodo={nodo} />}
        {vista === 'inicio' && <Inicio version={recarga} abrirRevision={(n) => { setPrARevisar(n); setVista('revisar'); }} />}
        {vista === 'tablero' && <Tablero />}
        {vista === 'revisar' && <RevisarPanel inicial={prARevisar} />}
        {vista === 'agentes' && <AgentesPanel perfil={perfil} />}
        {vista === 'hilos' && <HilosPanel />}
        {vista === 'ajustes' && <AjustesPanel perfil={perfil} alCambiar={() => setRecarga((x) => x + 1)} />}
      </main>
    </div>
  );
}
