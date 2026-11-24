import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bienvenida } from './components/Bienvenida';
import { Chat } from './components/Chat';
import { GraphView } from './components/GraphView';
import { Ajustes, type PestanaAjustes } from './components/Ajustes';
import { Ayuda } from './components/Ayuda';
import { Inicio } from './components/Inicio';
import { Notas } from './components/Notas';
import { Revisar } from './components/Revisar';
import { Recorrido, type PasoRecorrido } from './components/Recorrido';
import { Tablero } from './components/Tablero';
import { AgentesPanel, HilosPanel } from './components/Panels';
import { BarraTitulo } from './components/BarraTitulo';
import { InspectorNodo } from './components/InspectorNodo';
import { PaqueteFijado } from './components/PaqueteFijado';
import { Paleta } from './components/Paleta';
import { alIrASeccion, alPreguntarAlAgente, pedirDictado } from './lib/agente';
import { useDisposicion } from './lib/disposicion';
import { verGrafo } from './lib/grafoDatos';
import { api, enElectron, type Conexion, type PerfilVista } from './lib/api';
import type { NodoVista } from './lib/galaxy';

type Vista = 'asistente' | 'inicio' | 'tablero' | 'grafo' | 'notas' | 'revisar' | 'agentes' | 'hilos' | 'ajustes';
type Rol = 'desarrollador' | 'documentador' | 'tester' | 'integrador';
type Fase = 'carga' | 'bienvenida' | 'recorrido' | 'app';

const Icono = ({ d }: { d: ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

interface Seccion {
  id: Vista;
  nombre: string;
  icono: ReactNode;
  /** Roles que la ven; sin roles = todos. */
  roles?: Rol[];
  corto: string;
  tour: { titulo: string; texto: string };
}

const SECCIONES: Seccion[] = [
  { id: 'asistente', corto: 'Pregunta lo que quieras', nombre: 'Asistente', icono: <Icono d={<><path d="M4 5h16v11H9l-5 4z" /><path d="M8.5 10h7M8.5 13h4" /></>} />, tour: { titulo: 'Asistente', texto: 'Pregúntale lo que quieras. Conoce tu rol, tus tareas y tus PR. Prueba: «¿Qué tarea tengo?»' } },
  { id: 'inicio', corto: 'Tus tareas y PR de hoy', nombre: 'Mi día', icono: <Icono d={<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>} />, tour: { titulo: 'Mi día', texto: 'Tus tareas y PR por urgencia, con el comentario de entrega ya preparado.' } },
  { id: 'tablero', corto: 'Cola y plan por días', nombre: 'Tablero', roles: ['integrador'], icono: <Icono d={<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 4v16M15 4v10" /></>} />, tour: { titulo: 'Tablero', texto: 'La cola de revisión y el plan por días. Para integradores.' } },
  { id: 'grafo', corto: 'El mapa del proyecto', nombre: 'Grafo', icono: <Icono d={<><circle cx="6" cy="7" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="12" cy="17" r="2.2" /><path d="M8 8l3 7M16.2 7.7L13 15M8.2 7h7.6" /></>} />, tour: { titulo: 'Grafo', texto: 'El mapa del proyecto. Pasa el cursor para ver conexiones y copiar solo el contexto que necesitas.' } },
  { id: 'notas', corto: 'Documentos en Markdown', nombre: 'Notas', icono: <Icono d={<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>} />, tour: { titulo: 'Notas', texto: 'Los documentos del proyecto, para leer sin salir de la app.' } },
  { id: 'revisar', corto: 'Formato de cada PR', nombre: 'Revisar PR', roles: ['integrador'], icono: <Icono d={<><circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 8v8M18 10v3a4 4 0 01-4 4h-3.5" /></>} />, tour: { titulo: 'Revisar PR', texto: 'Todos los PR se revisan solos. Un clic copia o publica la lista de correcciones. Para integradores.' } },
  { id: 'agentes', corto: 'Orquestador y subagentes', nombre: 'Agentes', roles: ['desarrollador', 'documentador', 'integrador'], icono: <Icono d={<><rect x="5" y="8" width="14" height="10" rx="3" /><path d="M12 8V5M9.5 13h.01M14.5 13h.01M9 21h6" /></>} />, tour: { titulo: 'Agentes', texto: 'Un orquestador reparte un objetivo entre subagentes. Nada se publica sin tu confirmación.' } },
  { id: 'hilos', corto: 'El hilo de cada tarea', nombre: 'Hilos', icono: <Icono d={<><path d="M4 7c4-4 6 4 10 0s5-3 6-1M4 13c4-4 6 4 10 0s5-3 6-1M4 19c4-4 6 4 10 0s5-3 6-1" /></>} />, tour: { titulo: 'Hilos', texto: 'El hilo de tu tarea, para no perder el rumbo.' } },
  { id: 'ajustes', corto: 'Cuentas, modelos y ahorro', nombre: 'Ajustes', icono: <Icono d={<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>} />, tour: { titulo: 'Ajustes', texto: 'Cuentas, modelos, ahorro de tokens y tareas automáticas.' } },
];

const guardado = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const guardar = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento: el recorrido volverá a salir */
  }
};

export function App() {
  const [vista, setVista] = useState<Vista>('asistente');
  const [nodo, setNodo] = useState<NodoVista | null>(null);
  const [perfil, setPerfil] = useState<PerfilVista | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [prARevisar, setPrARevisar] = useState('');
  const [fase, setFase] = useState<Fase>('carga');
  const [con, setCon] = useState<Conexion | null>(null);
  const [rol, setRol] = useState<Rol | undefined>();
  // El recorrido espera a conocer el rol (o 8 s) para no cambiar de pasos a mitad de camino.
  const [esperaRol, setEsperaRol] = useState(true);
  const [ayuda, setAyuda] = useState(false);
  const [pestanaAjustes, setPestanaAjustes] = useState<PestanaAjustes>('cuentas');
  const [paleta, setPaleta] = useState(false);
  const [fijados, setFijados] = useState<string[]>([]);
  const [senalEnfocar, setSenalEnfocar] = useState(0);
  const disp = useDisposicion();
  const mac = (typeof window !== 'undefined' && window.hilo?.plataforma === 'darwin') || (!enElectron && /[?&]mac\b/.test(location.search));

  useEffect(() => alPreguntarAlAgente(() => setVista('asistente')), []);
  useEffect(() => alIrASeccion((id) => setVista(id as Vista)), []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaleta((x) => !x);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setVista('asistente');
        setTimeout(pedirDictado, 60);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  useEffect(() => void api.perfil().then(setPerfil), [recarga]);

  // Conexiones, rol y fase de arranque. Lo primero siempre es conectar GitHub y ClickUp.
  useEffect(() => {
    let vivo = true;
    void api.conexion().then((c) => {
      if (!vivo) return;
      setCon(c);
      const conectado = c.github.conectado && c.clickup.conectado;
      if (c.rol) setRol(c.rol as Rol);
      else if (conectado) void api.miDia().then((r) => vivo && setRol(r.dia.rol as Rol));
      else setEsperaRol(false);
      setFase((f) => {
        if (f !== 'carga') return f;
        if (!conectado && !sessionStorage.getItem('hilo.omitido')) return 'bienvenida';
        return guardado('hilo.recorrido') ? 'app' : 'recorrido';
      });
    });
    return () => {
      vivo = false;
    };
  }, [recarga]);

  useEffect(() => {
    if (rol) setEsperaRol(false);
    const t = setTimeout(() => setEsperaRol(false), 8000);
    return () => clearTimeout(t);
  }, [rol]);

  const visibles = useMemo(() => SECCIONES.filter((s) => !s.roles || (rol && s.roles.includes(rol))), [rol]);
  useEffect(() => {
    if (vista !== 'revisar' && !visibles.some((s) => s.id === vista)) setVista('asistente');
  }, [visibles, vista]);

  const conectado = Boolean(con?.github.conectado && con?.clickup.conectado);
  const pasos: PasoRecorrido[] = [
    { titulo: 'Así funciona Hilo', texto: 'Junta tu GitHub y tu ClickUp para decirte qué te toca. Un minuto de recorrido.' },
    ...visibles.map((s) => ({ objetivo: s.id, ...s.tour })),
    { titulo: 'Listo', texto: 'Empieza por el Asistente. El botón Ayuda siempre está abajo a la izquierda.' },
  ];

  const elegirId = (id: string) => {
    const n = verGrafo().nodos.find((x) => x.id === id);
    if (!n) return;
    setNodo(n as NodoVista);
    setSenalEnfocar((x) => x + 1);
    setVista('grafo');
  };
  const alternarFijado = (id: string) => setFijados((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const abrirRevision = (n: string) => {
    setPrARevisar(n);
    setVista('revisar');
  };

  return (
    <div className={`aplicacion pos-${disp.pos} modo-${disp.modo}${mac ? ' mac' : ''}`}>
      <div className="fondo-liquido" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <BarraTitulo
        mac={mac}
        seccion={SECCIONES.find((x) => x.id === vista)?.nombre ?? (vista === 'revisar' ? 'Revisar PR' : 'Hilo')}
        pos={disp.pos}
        modo={disp.modo}
        cambiar={disp.cambiar}
        alternar={disp.alternar}
        abrirPaleta={() => setPaleta(true)}
        abrirAhorro={() => {
          setPestanaAjustes('ahorro');
          setVista('ajustes');
        }}
        abrirAyuda={() => setAyuda(true)}
      />
      <div className="cuerpo">
      <nav className={`riel vidrio${disp.modo === 'iconos' ? ' solo-iconos' : ''}`} aria-label="Navegación">
        {visibles.map((s) => (
          <button key={s.id} data-tour={s.id} className={`riel-boton${vista === s.id ? ' activo' : ''}`} onClick={() => setVista(s.id)} title={`${s.nombre}: ${s.corto}`} aria-label={s.nombre}>
            {s.icono}
            <span>{s.nombre}</span>
          </button>
        ))}
        <span className="espacio" />
        <button className="riel-boton" data-tour="ayuda" onClick={() => setAyuda(true)} title="Ayuda" aria-label="Ayuda">
          <Icono d={<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-.8.6-1.5 1-1.5 2M12 17h.01" /></>} />
          <span>Ayuda</span>
        </button>
      </nav>
      <main className="principal">
        {fase === 'app' && !conectado && con && vista !== 'grafo' && (
          <div className="aviso-conexion vidrio">
            <span>Conecta GitHub y ClickUp para ver tus datos reales.</span>
            <button className="boton" onClick={() => setFase('bienvenida')}>
              Conectar ahora
            </button>
          </div>
        )}
        <div className={vista === 'grafo' ? 'ocupa' : 'oculta'}>
          <GraphView elegido={nodo} recargar={recarga} enfocar={senalEnfocar} alElegir={(n) => setNodo(n)} />
          {nodo && <InspectorNodo nodo={nodo} cerrar={() => setNodo(null)} alElegir={elegirId} fijado={fijados.includes(nodo.id)} alFijar={() => alternarFijado(nodo.id)} abrirNota={() => setVista('notas')} />}
          <PaqueteFijado ids={fijados} quitar={alternarFijado} vaciar={() => setFijados([])} />
        </div>
        <div className={vista === 'asistente' ? 'ocupa' : 'oculta'}>
          <Chat rol={rol} saludo={con?.github.login ?? con?.clickup.usuario} />
        </div>
        {vista === 'inicio' && <Inicio version={recarga} abrirRevision={abrirRevision} conectar={() => setFase('bienvenida')} />}
        {vista === 'tablero' && <Tablero />}
        {vista === 'notas' && <Notas nodo={nodo} />}
        {vista === 'revisar' && <Revisar inicial={prARevisar} integrador={rol === 'integrador'} volver={() => setVista('inicio')} />}
        {vista === 'agentes' && <AgentesPanel perfil={perfil} />}
        {vista === 'hilos' && <HilosPanel />}
        {vista === 'ajustes' && <Ajustes perfil={perfil} inicial={pestanaAjustes} alCambiar={() => setRecarga((x) => x + 1)} verRecorrido={() => setFase('recorrido')} />}
      </main>
      </div>

      {paleta && (
        <Paleta
          vista={vista}
          destinos={visibles.map((x) => ({ id: x.id, nombre: x.nombre, corto: x.corto }))}
          ir={(id) => setVista(id as Vista)}
          irANodo={elegirId}
          cerrar={() => setPaleta(false)}
        />
      )}
      {ayuda && (
        <Ayuda
          cerrar={() => setAyuda(false)}
          secciones={visibles.map((x) => ({ id: x.id, nombre: x.nombre, corto: x.corto, icono: x.icono }))}
          con={con}
          ir={(id) => setVista(id as Vista)}
          verRecorrido={() => setFase('recorrido')}
          probarConexiones={() => {
            setPestanaAjustes(conectado ? 'diagnostico' : 'cuentas');
            if (conectado) setVista('ajustes');
            else setFase('bienvenida');
          }}
        />
      )}
      {fase === 'bienvenida' && (
        <Bienvenida
          alOmitir={() => {
            sessionStorage.setItem('hilo.omitido', '1');
            setFase('app');
          }}
          alTerminar={() => {
            setRecarga((x) => x + 1);
            setFase(guardado('hilo.recorrido') ? 'app' : 'recorrido');
          }}
        />
      )}
      {fase === 'recorrido' && !esperaRol && (
        <Recorrido
          pasos={pasos}
          alCerrar={() => {
            guardar('hilo.recorrido', 'hecho');
            setFase('app');
          }}
        />
      )}
    </div>
  );
}
