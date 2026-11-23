import { useEffect, useState } from 'react';
import { api, type PaqueteVista, type Config, type EstadoSesion, type EventoAgente, type Funcion, type HiloVista, type Informe, type ModeloAsignado, type PerfilVista } from '../lib/api';

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
  { clave: 'asistente', nombre: 'Asistente (chat)', nota: 'Responde preguntas libres según tu rol, tus tareas y tus PR.' },
];

// ---------- Agentes ----------

function AhorroTokens() {
  const [r, setR] = useState<PaqueteVista | null>(null);
  const [hilos, setHilos] = useState<HiloVista[]>([]);
  const [hilo, setHilo] = useState('');
  const [copiado, setCopiado] = useState('');
  useEffect(() => void api.hilos().then(setHilos), []);
  const copiar = async (que: string, t: string) => {
    await api.copiar(t);
    setCopiado(que);
  };
  return (
    <section className="tarjeta">
      <header>
        <b>Ahorro de tokens</b>
      </header>
      <p className="suave">
        En vez de mandar el proyecto entero, se manda un mapa corto, solo la vecindad de lo que importa y el hilo de la tarea. Las notas se recortan a los párrafos que tocan la consulta y los logs se comprimen.
      </p>
      <div className="fila">
        <button
          className="boton secundario"
          onClick={async () => {
            const x = await api.resumen();
            setR(x);
            await copiar('resumen', x.texto);
          }}
        >
          {copiado === 'resumen' ? 'Resumen copiado' : 'Copiar resumen del proyecto'}
        </button>
        <select className="campo corto" value={hilo} onChange={(e) => setHilo(e.target.value)}>
          <option value="">Sin hilo</option>
          {hilos.map((h) => (
            <option key={h.id} value={h.id}>
              {h.id}
            </option>
          ))}
        </select>
        <button
          className="boton secundario"
          onClick={async () => {
            const x = await api.sesionNueva(hilo || undefined);
            await copiar('sesion', x.texto);
          }}
        >
          {copiado === 'sesion' ? 'Sesión copiada' : 'Copiar sesión nueva'}
        </button>
      </div>
      {r && (
        <p className="bien">
          ~{r.tokens.toLocaleString('es')} tokens en vez de ~{r.tokensTodo.toLocaleString('es')}: {Math.round(r.ahorro * 100)} % menos. Tokens estimados (caracteres entre 4).
        </p>
      )}
    </section>
  );
}

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
      <p className="suave">Un orquestador reparte el objetivo entre subagentes. Entregan borradores; nada se publica.</p>
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
      <AhorroTokens />
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
      <p className="suave">Objetivo, decisiones y lo que falta de cada tarea.</p>
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

