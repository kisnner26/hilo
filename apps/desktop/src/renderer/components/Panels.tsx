import { useEffect, useMemo, useState } from 'react';
import { Conexiones } from './Conexiones';
import { api, type Config, type EstadoSesion, type EventoAgente, type Funcion, type HiloVista, type Informe, type ModeloAsignado, type PerfilVista } from '../lib/api';
import { mdAHtml } from '../lib/markdown';
import type { NodoVista } from '../lib/galaxy';

const MODELOS = [
  { id: 'claude-opus-5-5', nombre: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', nombre: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', nombre: 'Haiku 5.5' },
];
const ESFUERZOS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const NOMBRE_ESFUERZO: Record<string, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo' };
const ROLES = ['desarrollador', 'documentador', 'tester', 'integrador'] as const;
const FUNCIONES: { clave: Funcion; nombre: string; nota: string }[] = [
  { clave: 'orquestador', nombre: 'Orquestador', nota: 'Planifica y reparte. Recomendado: Opus 5.5, esfuerzo medio o alto.' },
  { clave: 'desarrollo', nombre: 'Desarrollo', nota: 'Subagente de código. Recomendado: Sonnet 5.5.' },
  { clave: 'documentacion', nombre: 'Documentación', nota: 'Subagente de documentos. Recomendado: Haiku 5.5.' },
  { clave: 'integracion', nombre: 'Integración', nota: 'Revisa PR y arma comentarios.' },
  { clave: 'testing', nombre: 'Testing', nota: 'Casos y evidencia.' },
];

// ---------- Notas ----------

export function NotasPanel({ nodo }: { nodo: NodoVista | null }) {
  const [lista, setLista] = useState<{ ruta: string; titulo: string; carpeta: string }[]>([]);
  const [abierta, setAbierta] = useState<string>('');
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState('');
  useEffect(() => void api.notas().then(setLista), []);
  useEffect(() => {
    if (nodo?.archivo && lista.some((n) => n.ruta === nodo.archivo)) setAbierta(nodo.archivo);
  }, [nodo, lista]);
  useEffect(() => {
    if (abierta) void api.nota(abierta).then((t) => setTexto(t ?? 'No se pudo leer la nota.'));
  }, [abierta]);
  const grupos = useMemo(() => {
    const m = new Map<string, typeof lista>();
    for (const n of lista.filter((x) => `${x.titulo} ${x.ruta}`.toLowerCase().includes(filtro.toLowerCase()))) m.set(n.carpeta, [...(m.get(n.carpeta) ?? []), n]);
    return [...m.entries()];
  }, [lista, filtro]);
  return (
    <div className="dos-columnas">
      <div className="arbol">
        <input className="buscar" placeholder="Buscar nota" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        {grupos.length === 0 && <p className="suave">No hay notas. Conecta una carpeta de Markdown en Ajustes.</p>}
        {grupos.map(([carpeta, notas]) => (
          <details key={carpeta} open>
            <summary>{carpeta}</summary>
            {notas.map((n) => (
              <button key={n.ruta} className={`item-arbol${abierta === n.ruta ? ' activo' : ''}`} onClick={() => setAbierta(n.ruta)}>
                {n.titulo}
              </button>
            ))}
          </details>
        ))}
      </div>
      <article className="documento" dangerouslySetInnerHTML={{ __html: abierta ? mdAHtml(texto) : '<p class="suave">Elige una nota.</p>' }} />
    </div>
  );
}

// ---------- Revisar PR ----------

export function RevisarPanel({ inicial = '' }: { inicial?: string }) {
  const [numero, setNumero] = useState(inicial);
  const [aviso, setAviso] = useState('');
  const [informe, setInforme] = useState<Informe | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const revisar = async () => {
    setCargando(true);
    setError('');
    try {
      setInforme(await api.revisarPr(numero.replace('#', '')));
    } catch (e) {
      setError(`No se pudo revisar: ${String(e)}. Comprueba que gh esté instalado y con sesión.`);
      setInforme(null);
    } finally {
      setCargando(false);
    }
  };
  useEffect(() => {
    if (inicial) {
      setNumero(inicial);
      void (async () => {
        setCargando(true);
        try {
          setInforme(await api.revisarPr(inicial));
        } catch (e) {
          setError(`No se pudo revisar: ${String(e)}`);
        } finally {
          setCargando(false);
        }
      })();
    }
  }, [inicial]);
  const todo = informe ? [...informe.errores.map((h) => ({ ...h, g: 'ERROR' })), ...informe.avisos.map((h) => ({ ...h, g: 'AVISO' }))] : [];
  const comentario = informe
    ? [`Revisión de Integración del #${numero}. Corrige esto antes de la siguiente revisión:`, '', ...todo.map((h, i) => `${i + 1}. ${h.mensaje}${h.arreglo ? ` ${h.arreglo}` : ''}`), ...(informe.verificaciones.length ? ['', 'Corre y pega el resultado en Validaciones:', ...informe.verificaciones.map((v) => `- ${v}`)] : [])].join('\n')
    : '';
  return (
    <div className="columna">
      <h2>Revisar un PR</h2>
      <p className="suave">Una sola lista con todo lo que el formato acordado exige, para devolverla en un único comentario.</p>
      <div className="fila">
        <input className="campo" placeholder="Número de PR, por ejemplo 79" value={numero} onChange={(e) => setNumero(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && numero && void revisar()} />
        <button className="boton" disabled={!numero || cargando} onClick={() => void revisar()}>
          {cargando ? 'Revisando…' : 'Revisar'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {informe && (
        <>
          <p className={informe.ok ? 'bien' : 'mal'}>{informe.ok ? `Listo para fusionar el formato (${informe.lineas} líneas).` : `Con ${informe.errores.length} error(es) (${informe.lineas} líneas).`}</p>
          <ul className="hallazgos">
            {todo.map((h, i) => (
              <li key={i} className={h.g === 'ERROR' ? 'hall-error' : 'hall-aviso'}>
                <b>{h.g}</b> [{h.regla}] {h.mensaje}
                {h.arreglo && <em>{h.arreglo}</em>}
              </li>
            ))}
          </ul>
          {!informe.ok && (
            <div className="fila">
              <button className="boton secundario" onClick={() => void api.copiar(comentario)}>
                Copiar como un solo comentario
              </button>
              <button
                className="boton"
                onClick={async () => {
                  try {
                    const r = await api.publicarGithub(numero.replace('#', ''), comentario);
                    setAviso(r.publicado ? `Publicado: ${r.enlace ?? ''}` : 'No se publicó.');
                  } catch (e) {
                    setAviso(String(e instanceof Error ? e.message : e));
                  }
                }}
              >
                Publicar en el PR
              </button>
            </div>
          )}
          {aviso && <p className="suave">{aviso}</p>}
        </>
      )}
    </div>
  );
}

// ---------- Agentes ----------

export function AgentesPanel({ perfil }: { perfil: PerfilVista | null }) {
  const [objetivo, setObjetivo] = useState('');
  const [rol, setRol] = useState<(typeof ROLES)[number]>('desarrollador');
  const [eventos, setEventos] = useState<EventoAgente[]>([]);
  const [corriendo, setCorriendo] = useState(false);
  useEffect(
    () =>
      api.alEvento((e) => {
        setEventos((x) => [...x, e]);
        if (e.fase === 'fin') setCorriendo(false);
      }),
    [],
  );
  return (
    <div className="columna">
      <h2>Agentes</h2>
      <p className="suave">
        Un orquestador divide el objetivo y manda subagentes. Cada uno recibe solo el contexto de su parte y el hilo de la tarea. Nada se publica: los agentes entregan borradores.
      </p>
      <div className="fila">
        <select className="campo corto" value={rol} onChange={(e) => setRol(e.target.value as typeof rol)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input className="campo" placeholder="Objetivo, por ejemplo: pruebas de R1 y R2 de BFA-BE-04" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} />
        <button
          className="boton"
          disabled={!objetivo || corriendo}
          onClick={() => {
            setEventos([]);
            setCorriendo(true);
            api.orquestar({ objetivo, rol });
          }}
        >
          {corriendo ? 'En curso…' : 'Orquestar'}
        </button>
      </div>
      {perfil && (
        <p className="suave">
          Orquestador: {MODELOS.find((m) => m.id === perfil.modelos.orquestador.modelo)?.nombre} · {NOMBRE_ESFUERZO[perfil.modelos.orquestador.esfuerzo]}. Subagente de {rol}: {MODELOS.find((m) => m.id === perfil.modelos[rol === 'desarrollador' ? 'desarrollo' : rol === 'documentador' ? 'documentacion' : rol === 'tester' ? 'testing' : 'integracion'].modelo)?.nombre}.
        </p>
      )}
      <div className="registro">
        {eventos.length === 0 && <p className="suave">Sin ejecuciones todavía.</p>}
        {eventos.map((e, i) => (
          <div key={i} className={`evento ${e.estado}`}>
            <header>
              {e.fase === 'subagente' ? `Subagente · ${e.rol}` : e.fase === 'orquestador' ? 'Orquestador' : 'Resultado'}
              {e.modelo ? ` · ${e.modelo}` : ''}
              {e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ''}
            </header>
            <pre>{e.texto}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Hilos ----------

export function HilosPanel() {
  const [hilos, setHilos] = useState<HiloVista[]>([]);
  const [nuevo, setNuevo] = useState({ id: '', objetivo: '', rol: 'desarrollador', tarea: '' });
  useEffect(() => void api.hilos().then(setHilos), []);
  const crear = async () => {
    const h: HiloVista = { id: nuevo.id.trim(), rol: nuevo.rol, objetivo: nuevo.objetivo.trim(), ...(nuevo.tarea ? { tarea: nuevo.tarea.trim() } : {}), plan: [], decisiones: [], abiertas: [], prohibido: [], actualizado: new Date().toISOString() };
    setHilos(await api.guardarHilo(h));
    setNuevo({ id: '', objetivo: '', rol: 'desarrollador', tarea: '' });
  };
  const marcar = async (h: HiloVista, i: number) => setHilos(await api.guardarHilo({ ...h, plan: h.plan.map((p, k) => (k === i ? { ...p, hecho: !p.hecho } : p)) }));
  const [paso, setPaso] = useState<Record<string, string>>({});
  return (
    <div className="columna">
      <h2>Hilos de trabajo</h2>
      <p className="suave">El hilo guarda el objetivo, el rol, lo decidido y lo que falta. Se reinyecta completo en cada turno para que una sesión larga no pierda el rumbo.</p>
      <div className="fila">
        <input className="campo corto" placeholder="id (bfa-be-04)" value={nuevo.id} onChange={(e) => setNuevo({ ...nuevo, id: e.target.value })} />
        <select className="campo corto" value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <input className="campo" placeholder="Objetivo" value={nuevo.objetivo} onChange={(e) => setNuevo({ ...nuevo, objetivo: e.target.value })} />
        <button className="boton" disabled={!nuevo.id || !nuevo.objetivo} onClick={() => void crear()}>
          Crear
        </button>
      </div>
      {hilos.map((h) => (
        <section className="tarjeta" key={h.id}>
          <header>
            <b>{h.id}</b> · {h.rol}
            {h.tarea ? ` · ${h.tarea}` : ''}
          </header>
          <p>{h.objetivo}</p>
          <ul className="pasos">
            {h.plan.map((p, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={p.hecho} onChange={() => void marcar(h, i)} /> <span className={p.hecho ? 'tachado' : ''}>{p.texto}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="fila">
            <input className="campo" placeholder="Agregar paso" value={paso[h.id] ?? ''} onChange={(e) => setPaso({ ...paso, [h.id]: e.target.value })} />
            <button
              className="boton secundario"
              disabled={!paso[h.id]}
              onClick={async () => {
                setHilos(await api.guardarHilo({ ...h, plan: [...h.plan, { texto: paso[h.id]!, hecho: false }] }));
                setPaso({ ...paso, [h.id]: '' });
              }}
            >
              Agregar
            </button>
          </div>
          {h.decisiones.length > 0 && <p className="suave">Decidido: {h.decisiones.map((d) => `${d.texto} (${d.motivo})`).join('; ')}</p>}
        </section>
      ))}
    </div>
  );
}

// ---------- Ajustes ----------

export function AjustesPanel({ perfil, alCambiar }: { perfil: PerfilVista | null; alCambiar: () => void }) {
  const [config, setConfig] = useState<Config>({});
  const [sesiones, setSesiones] = useState<{ claude: EstadoSesion; codex: EstadoSesion } | null>(null);
  const [ocupado, setOcupado] = useState('');
  const cargar = () => void api.config().then(setConfig);
  useEffect(() => {
    cargar();
    void api.sesiones().then(setSesiones);
  }, []);
  const guardar = async (c: Config) => {
    setConfig(await api.guardarConfig(c));
    alCambiar();
  };
  const elegir = async (clave: 'grafo' | 'boveda', tipo: 'archivo' | 'carpeta') => {
    const r = await api.abrir(tipo);
    if (r) await guardar({ [clave]: r });
  };
  const modelos = { ...(perfil?.modelos ?? {}), ...(config.modelos ?? {}) } as Record<Funcion, ModeloAsignado>;
  const cambiarModelo = (f: Funcion, p: Partial<ModeloAsignado>) => void guardar({ modelos: { ...(config.modelos ?? {}), [f]: { ...modelos[f], ...p } } });
  const entrar = async (cli: 'claude' | 'codex') => {
    setOcupado(cli);
    try {
      const e = await api.iniciarSesion(cli);
      setSesiones((s) => (s ? { ...s, [cli]: e } : s));
    } catch (e) {
      setSesiones((s) => (s ? { ...s, [cli]: { ...s[cli], detalle: `No se pudo iniciar sesión: ${String(e)}` } } : s));
    } finally {
      setOcupado('');
    }
  };
  const fila = (t: string, v: string | undefined, boton: () => void) => (
    <div className="fila-ajuste-grande">
      <span>{t}</span>
      <code>{v ?? 'sin definir'}</code>
      <button className="boton secundario" onClick={boton}>
        Elegir
      </button>
    </div>
  );
  return (
    <div className="columna">
      <h2>Ajustes</h2>

      <h3>Conexiones</h3>
      <Conexiones alCambiar={alCambiar} />

      <h3>Suscripciones</h3>
      <p className="suave">Hilo no usa claves de API. Inicia sesión con tu suscripción en la herramienta oficial; Hilo solo la lanza.</p>
      {sesiones &&
        (['claude', 'codex'] as const).map((cli) => {
          const s = sesiones[cli];
          return (
            <div className="fila-ajuste-grande" key={cli}>
              <span>{cli === 'claude' ? 'Claude Code' : 'Codex'}</span>
              <code>{s.instalado ? (s.conectado ? `Conectado · ${s.detalle}` : 'Sin sesión') : 'No instalado'}</code>
              <button className="boton secundario" disabled={!s.instalado || ocupado === cli} onClick={() => void entrar(cli)}>
                {s.conectado ? 'Cambiar cuenta' : ocupado === cli ? 'Abriendo…' : 'Iniciar sesión'}
              </button>
            </div>
          );
        })}

      <h3>Modelos y esfuerzo</h3>
      {FUNCIONES.map((f) => (
        <div className="fila-modelo" key={f.clave}>
          <div>
            <b>{f.nombre}</b>
            <span className="suave">{f.nota}</span>
          </div>
          <select className="campo corto" value={modelos[f.clave]?.modelo} onChange={(e) => cambiarModelo(f.clave, { modelo: e.target.value })}>
            {MODELOS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
          <select className="campo corto" value={modelos[f.clave]?.esfuerzo} onChange={(e) => cambiarModelo(f.clave, { esfuerzo: e.target.value as ModeloAsignado['esfuerzo'] })}>
            {ESFUERZOS.map((e) => (
              <option key={e} value={e}>
                {NOMBRE_ESFUERZO[e]}
              </option>
            ))}
          </select>
        </div>
      ))}
      <label className="casilla">
        <input type="checkbox" checked={Boolean(config.permitirEditar)} onChange={(e) => void guardar({ permitirEditar: e.target.checked })} /> Permitir que el subagente de desarrollo edite archivos (por defecto solo propone)
      </label>

      <h3>Contexto</h3>
      {fila('Grafo (graph.json de graphify)', config.grafo, () => void elegir('grafo', 'archivo'))}
      {fila('Carpeta de Markdown', config.boveda, () => void elegir('boveda', 'carpeta'))}
    </div>
  );
}
