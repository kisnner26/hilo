import { useEffect, useState } from 'react';
import { UsoReal } from './Uso';
import { api, type AhorroVista, type Conexion, type Config, type EstadoSesion, type Funcion, type InstalacionesVista, type ModeloAsignado, type PerfilVista, type ProgramadaVista, type Prueba } from '../lib/api';
import { Actualizaciones } from './Actualizaciones';
import { MotorIA } from './MotorIA';
import { Conexiones } from './Conexiones';

export type PestanaAjustes = 'cuentas' | 'modelos' | 'ahorro' | 'automatico' | 'actualizar' | 'diagnostico';

const PESTANAS: { id: PestanaAjustes; nombre: string }[] = [
  { id: 'cuentas', nombre: 'Cuentas' },
  { id: 'modelos', nombre: 'Modelos' },
  { id: 'ahorro', nombre: 'Ahorro' },
  { id: 'automatico', nombre: 'Automático' },
  { id: 'actualizar', nombre: 'Actualizaciones' },
  { id: 'diagnostico', nombre: 'Diagnóstico' },
];

const limpio = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Interruptor({ valor, alCambiar, deshabilitado, etiqueta }: { valor: boolean; alCambiar: (v: boolean) => void; deshabilitado?: boolean; etiqueta: string }) {
  return (
    <button role="switch" aria-checked={valor} aria-label={etiqueta} disabled={deshabilitado} className={`switch${valor ? ' si' : ''}`} onClick={() => alCambiar(!valor)}>
      <span />
    </button>
  );
}

// ---------- Cuentas ----------

function TabCuentas({ alCambiar }: { alCambiar: () => void }) {
  const [config, setConfig] = useState<Config>({});
  const [con, setCon] = useState<Conexion | null>(null);
  const [instal, setInstal] = useState<InstalacionesVista | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void api.config().then(setConfig);
    void api.conexion().then(setCon);
  }, []);
  const elegir = async (clave: 'grafo' | 'boveda' | 'proyecto', tipo: 'archivo' | 'carpeta') => {
    const r = await api.abrir(tipo);
    if (r) {
      setConfig(await api.guardarConfig({ [clave]: r }));
      alCambiar();
    }
  };
  const filas: [string, 'grafo' | 'boveda' | 'proyecto', 'archivo' | 'carpeta', string | undefined][] = [
    ['Grafo del proyecto', 'grafo', 'archivo', config.grafo],
    ['Notas en Markdown', 'boveda', 'carpeta', config.boveda],
    ['Repositorio local', 'proyecto', 'carpeta', config.proyecto],
  ];
  return (
    <div className="pestana">
      <Conexiones alCambiar={alCambiar} />
      <section className="conexion">
        <header>
          <b>Carpetas</b>
        </header>
        {filas.map(([nombre, clave, tipo, valor]) => (
          <div className="fila-carpeta" key={clave}>
            <span>{nombre}</span>
            <code title={valor}>{valor ? valor.split('/').slice(-2).join('/') : 'sin definir'}</code>
            <button className="boton secundario" onClick={() => void elegir(clave, tipo)}>
              Elegir
            </button>
          </div>
        ))}
      </section>
      {con?.creador && (
        <section className="conexion">
          <header>
            <b>Instalaciones</b>
            <span className="suave">solo tú, como creador</span>
          </header>
          <button className="boton secundario" onClick={async () => { setMsg(''); try { setInstal(await api.instalaciones()); } catch (e) { setMsg(limpio(e)); } }}>
            Ver descargas
          </button>
          {instal && (
            <table className="tabla">
              <tbody>
                {instal.releases.length === 0 && (
                  <tr>
                    <td>Todavía no hay releases.</td>
                  </tr>
                )}
                {instal.releases.map((r) => (
                  <tr key={r.tag}>
                    <td className="mono">{r.tag}</td>
                    <td>{r.total} descargas</td>
                    <td className="suave">{r.activos.map((a) => `${a.nombre.split('.').pop()}: ${a.descargas}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {msg && <p className="error">{msg}</p>}
        </section>
      )}
    </div>
  );
}

// ---------- Modelos ----------

const MODELOS = [
  { id: 'claude-opus-5-5', nombre: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', nombre: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', nombre: 'Haiku 5.5' },
];
const ESFUERZOS = [
  ['low', 'Bajo'],
  ['medium', 'Medio'],
  ['high', 'Alto'],
  ['xhigh', 'Muy alto'],
  ['max', 'Máximo'],
] as const;
const FUNCIONES: { clave: Funcion; nombre: string; nota: string }[] = [
  { clave: 'asistente', nombre: 'Asistente', nota: 'El chat' },
  { clave: 'orquestador', nombre: 'Orquestador', nota: 'Planifica y reparte' },
  { clave: 'desarrollo', nombre: 'Desarrollo', nota: 'Subagente de código' },
  { clave: 'documentacion', nombre: 'Documentación', nota: 'Subagente de textos' },
  { clave: 'integracion', nombre: 'Integración', nota: 'Revisión y comentarios' },
  { clave: 'testing', nombre: 'Testing', nota: 'Casos y evidencia' },
];

function TabModelos({ perfil, alCambiar }: { perfil: PerfilVista | null; alCambiar: () => void }) {
  const [config, setConfig] = useState<Config>({});
  const [ses, setSes] = useState<{ claude: EstadoSesion; codex: EstadoSesion } | null>(null);
  const [ocupado, setOcupado] = useState('');
  useEffect(() => {
    void api.config().then(setConfig);
    void api.sesiones().then(setSes);
  }, []);
  const modelos = { ...(perfil?.modelos ?? {}), ...(config.modelos ?? {}) } as Record<Funcion, ModeloAsignado>;
  const cambiar = async (f: Funcion, p: Partial<ModeloAsignado>) => {
    setConfig(await api.guardarConfig({ modelos: { ...(config.modelos ?? {}), [f]: { ...modelos[f], ...p } } }));
    alCambiar();
  };
  const entrar = async (cli: 'claude' | 'codex') => {
    setOcupado(cli);
    try {
      const e = await api.iniciarSesion(cli);
      setSes((s) => (s ? { ...s, [cli]: e } : s));
    } catch (e) {
      setSes((s) => (s ? { ...s, [cli]: { ...s[cli], detalle: limpio(e) } } : s));
    } finally {
      setOcupado('');
    }
  };
  return (
    <div className="pestana">
      <MotorIA />
      <section className="conexion">
        <header>
          <b>Suscripciones</b>
          <span className="suave">sin claves de API</span>
        </header>
        {ses &&
          (['claude', 'codex'] as const).map((cli) => {
            const s = ses[cli];
            return (
              <div className="fila-carpeta" key={cli}>
                <span>{cli === 'claude' ? 'Claude Code' : 'Codex'}</span>
                <code>{s.instalado ? (s.conectado ? s.detalle : 'Sin sesión') : 'No instalado'}</code>
                <button className="boton secundario" disabled={!s.instalado || ocupado === cli} onClick={() => void entrar(cli)}>
                  {s.conectado ? 'Cambiar' : 'Entrar'}
                </button>
              </div>
            );
          })}
      </section>
      <section className="conexion">
        <header>
          <b>Modelo y esfuerzo</b>
          <span className="suave">por función</span>
        </header>
        {FUNCIONES.map((f) => (
          <div className="fila-modelo" key={f.clave}>
            <div>
              <b>{f.nombre}</b>
              <span className="suave">{f.nota}</span>
            </div>
            <select className="campo" value={modelos[f.clave]?.modelo} onChange={(e) => void cambiar(f.clave, { modelo: e.target.value })}>
              {MODELOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
            <select className="campo" value={modelos[f.clave]?.esfuerzo} onChange={(e) => void cambiar(f.clave, { esfuerzo: e.target.value as ModeloAsignado['esfuerzo'] })}>
              {ESFUERZOS.map(([id, n]) => (
                <option key={id} value={id}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>
      <section className="conexion">
        <div className="fila-interruptor">
          <div>
            <b>Permitir que Desarrollo edite archivos</b>
            <span className="suave">Apagado, los agentes solo proponen.</span>
          </div>
          <Interruptor etiqueta="Permitir editar" valor={Boolean(config.permitirEditar)} alCambiar={async (v) => setConfig(await api.guardarConfig({ permitirEditar: v }))} />
        </div>
      </section>
    </div>
  );
}

// ---------- Ahorro de tokens ----------

const PRESETS: Record<'maximo' | 'equilibrado' | 'libre', AhorroVista> = {
  maximo: { activo: true, resumen: true, alcance: true, extractos: true, estiloBreve: true, comprimirLogs: true, sesionContinua: true, respuestasInmediatas: true, contextoMinimo: true, modeloEscalonado: true, cachePasos: true, topeUsdPaso: 0.8, presupuesto: 800, maxSubagentes: 3, maxLineasDiff: 150, maxCaracteresNota: 600 },
  equilibrado: { activo: true, resumen: true, alcance: true, extractos: true, estiloBreve: true, comprimirLogs: true, sesionContinua: true, respuestasInmediatas: true, contextoMinimo: true, modeloEscalonado: true, cachePasos: true, topeUsdPaso: 1.5, presupuesto: 1500, maxSubagentes: 5, maxLineasDiff: 300, maxCaracteresNota: 1000 },
  libre: { activo: false, resumen: false, alcance: false, extractos: false, estiloBreve: false, comprimirLogs: false, sesionContinua: true, respuestasInmediatas: true, contextoMinimo: false, modeloEscalonado: false, cachePasos: true, topeUsdPaso: 6, presupuesto: 6000, maxSubagentes: 6, maxLineasDiff: 800, maxCaracteresNota: 3000 },
};
const TECNICAS: { clave: keyof AhorroVista; nombre: string; detalle: string }[] = [
  { clave: 'resumen', nombre: 'Resumen del proyecto', detalle: 'Un mapa corto en vez de listar todo' },
  { clave: 'alcance', nombre: 'Contexto acotado', detalle: 'Solo lo cercano a la tarea y a tu rol' },
  { clave: 'extractos', nombre: 'Notas recortadas', detalle: 'Solo los párrafos que importan' },
  { clave: 'estiloBreve', nombre: 'Respuestas breves', detalle: 'Sin preámbulos en código y pruebas' },
  { clave: 'comprimirLogs', nombre: 'Logs y diffs comprimidos', detalle: 'Quita ruido antes de enviar' },
  { clave: 'sesionContinua', nombre: 'Conversación continuada', detalle: 'No reenvía el historial' },
  { clave: 'contextoMinimo', nombre: 'Contexto mínimo del agente', detalle: 'Sin servidores MCP ni herramientas de más: ~10 mil tokens por consulta en vez de ~69 mil' },
  { clave: 'modeloEscalonado', nombre: 'Modelo según el paso', detalle: 'Redactar con uno ligero, editar código con el de desarrollo' },
  { clave: 'cachePasos', nombre: 'No pagar dos veces', detalle: 'Un paso idéntico sobre el mismo commit reutiliza su respuesta' },
  { clave: 'respuestasInmediatas', nombre: 'Respuestas locales', detalle: '«¿Qué tarea tengo?» sin modelo' },
];
const TOPES: { clave: keyof AhorroVista; nombre: string; min: number; max: number; paso: number; unidad: string }[] = [
  { clave: 'presupuesto', nombre: 'Contexto por consulta', min: 300, max: 8000, paso: 100, unidad: 'tokens' },
  { clave: 'maxSubagentes', nombre: 'Subagentes por orquestación', min: 1, max: 8, paso: 1, unidad: '' },
  { clave: 'maxLineasDiff', nombre: 'Líneas de diff', min: 100, max: 1000, paso: 50, unidad: 'líneas' },
  { clave: 'maxCaracteresNota', nombre: 'Texto por nota', min: 300, max: 4000, paso: 100, unidad: 'caracteres' },
  { clave: 'topeUsdPaso', nombre: 'Gasto máximo por paso del autopiloto', min: 0.2, max: 8, paso: 0.2, unidad: 'USD' },
];

function TabAhorro() {
  const [a, setA] = useState<AhorroVista>(PRESETS.equilibrado);
  const [cargado, setCargado] = useState(false);
  useEffect(() => void api.config().then((c) => { setA({ ...PRESETS.equilibrado, ...(c.ahorro ?? {}) }); setCargado(true); }), []);
  const guardar = (n: AhorroVista) => {
    setA(n);
    void api.guardarConfig({ ahorro: n });
  };
  const preset = (['maximo', 'equilibrado', 'libre'] as const).find((p) => JSON.stringify(PRESETS[p]) === JSON.stringify(a));
  const efectivo = a.activo ? a.presupuesto : PRESETS.libre.presupuesto;
  if (!cargado) return null;
  return (
    <div className="pestana">
      <UsoReal />
      <section className="conexion destacada">
        <div className="fila-interruptor">
          <div>
            <b>Ahorro de tokens</b>
            <span className="suave">{a.activo ? 'Encendido: contextos cortos y respuestas directas.' : 'Apagado: contextos amplios, ideal para modelos fuertes.'}</span>
          </div>
          <Interruptor etiqueta="Ahorro de tokens" valor={a.activo} alCambiar={(v) => guardar({ ...a, activo: v })} />
        </div>
        <div className="segmentos-v ancho">
          {(
            [
              ['maximo', 'Máximo ahorro'],
              ['equilibrado', 'Equilibrado'],
              ['libre', 'Sin límites'],
            ] as const
          ).map(([k, n]) => (
            <button key={k} className={preset === k ? 'activo' : ''} onClick={() => guardar(PRESETS[k])}>
              {n}
            </button>
          ))}
        </div>
        <div className="medidor">
          <span>Contexto por consulta</span>
          <strong>~{efectivo.toLocaleString('es')} tokens</strong>
          <div className="barra-medidor">
            <i style={{ width: `${Math.min(100, (efectivo / 8000) * 100)}%` }} />
          </div>
        </div>
      </section>

      <section className={`conexion${a.activo ? '' : ' apagada'}`}>
        <header>
          <b>Técnicas</b>
        </header>
        {TECNICAS.map((t) => (
          <div className="fila-interruptor" key={t.clave}>
            <div>
              <b>{t.nombre}</b>
              <span className="suave">{t.detalle}</span>
            </div>
            <Interruptor etiqueta={t.nombre} valor={Boolean(a[t.clave])} deshabilitado={!a.activo && t.clave !== 'sesionContinua' && t.clave !== 'respuestasInmediatas' && t.clave !== 'cachePasos'} alCambiar={(v) => guardar({ ...a, [t.clave]: v })} />
          </div>
        ))}
      </section>

      <section className={`conexion${a.activo ? '' : ' apagada'}`}>
        <header>
          <b>Topes</b>
        </header>
        {TOPES.map((t) => (
          <div className="fila-tope" key={t.clave}>
            <span>{t.nombre}</span>
            <input type="range" min={t.min} max={t.max} step={t.paso} value={a[t.clave] as number} disabled={!a.activo} onChange={(e) => guardar({ ...a, [t.clave]: Number(e.target.value) })} />
            <span className="valor">
              {(a[t.clave] as number).toLocaleString('es')} {t.unidad}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---------- Automático ----------

const META: Record<ProgramadaVista['id'], { nombre: string; detalle: string; modo: 'cada' | 'hora'; opciones?: number[]; soloIntegrador?: boolean }> = {
  avisos: { nombre: 'Avisos urgentes', detalle: 'CI roto, cambios pedidos, tareas vencidas', modo: 'cada', opciones: [5, 15, 30, 60] },
  'resumen-dia': { nombre: 'Resumen del día', detalle: 'Tus tareas y PR cada mañana', modo: 'hora' },
  'revisar-prs': { nombre: 'Revisar PR nuevos', detalle: 'Revisa el formato y avisa de los que fallan', modo: 'cada', opciones: [10, 15, 30, 60], soloIntegrador: true },
  'informe-cola': { nombre: 'Informe de la cola', detalle: 'Rondas y carga de revisión', modo: 'hora', soloIntegrador: true },
  autopiloto: { nombre: 'Preparar el piloto automático', detalle: 'Deja listo, sin gastar tokens, lo que Hilo resuelve solo: ramas al día, avisos y entregas redactadas', modo: 'hora' },
};

function TabAutomatico() {
  const [lista, setLista] = useState<ProgramadaVista[]>([]);
  const [integrador, setIntegrador] = useState(false);
  const [corriendo, setCorriendo] = useState('');
  useEffect(() => void api.programadas().then((r) => { setLista(r.lista); setIntegrador(r.integrador); }), []);
  const guardar = async (n: ProgramadaVista[]) => {
    setLista(n);
    setLista(await api.guardarProgramadas(n));
  };
  const cambiar = (id: string, p: Partial<ProgramadaVista>) => void guardar(lista.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const ejecutar = async (id: ProgramadaVista['id']) => {
    setCorriendo(id);
    try {
      const r = await api.ejecutarProgramada(id);
      setLista((l) => l.map((x) => (x.id === id ? { ...x, ultima: new Date().toISOString(), resultado: r } : x)));
    } catch (e) {
      setLista((l) => l.map((x) => (x.id === id ? { ...x, resultado: `Error: ${limpio(e)}` } : x)));
    } finally {
      setCorriendo('');
    }
  };
  return (
    <div className="pestana">
      {lista.map((p) => {
        const m = META[p.id];
        const bloqueada = m.soloIntegrador && !integrador;
        return (
          <section className={`conexion${bloqueada ? ' apagada' : ''}`} key={p.id}>
            <div className="fila-interruptor">
              <div>
                <b>{m.nombre}</b>
                <span className="suave">{bloqueada ? 'Solo para integradores' : m.detalle}</span>
              </div>
              <Interruptor etiqueta={m.nombre} valor={p.activo} deshabilitado={bloqueada} alCambiar={(v) => cambiar(p.id, { activo: v })} />
            </div>
            {!bloqueada && (
              <div className="fila-programada">
                {m.modo === 'cada' ? (
                  <label>
                    Cada
                    <select className="campo" value={p.cadaMin} onChange={(e) => cambiar(p.id, { cadaMin: Number(e.target.value) })}>
                      {m.opciones?.map((o) => (
                        <option key={o} value={o}>
                          {o} min
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    A las
                    <input className="campo" type="time" value={p.hora ?? '09:00'} onChange={(e) => cambiar(p.id, { hora: e.target.value })} />
                  </label>
                )}
                <span className="ultima">{p.resultado ? `${p.resultado}${p.ultima ? ` · ${new Date(p.ultima).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'Aún no se ejecutó'}</span>
                <button className="boton secundario" disabled={corriendo === p.id} onClick={() => void ejecutar(p.id)}>
                  {corriendo === p.id ? 'Ejecutando…' : 'Ejecutar ahora'}
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------- Diagnóstico ----------

function TabDiagnostico() {
  const [pruebas, setPruebas] = useState<Prueba[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const correr = async () => {
    setOcupado(true);
    try {
      setPruebas(await api.diagnostico());
    } finally {
      setOcupado(false);
    }
  };
  useEffect(() => void correr(), []);
  const fallas = pruebas?.filter((p) => p.estado === 'error').length ?? 0;
  return (
    <div className="pestana">
      <section className="conexion">
        <div className="fila-interruptor">
          <div>
            <b>{pruebas ? (fallas === 0 ? 'Todo en orden' : `${fallas} cosa${fallas === 1 ? '' : 's'} por revisar`) : 'Probando…'}</b>
            <span className="suave">Herramientas, cuentas y suscripciones</span>
          </div>
          <button className="boton secundario" disabled={ocupado} onClick={() => void correr()}>
            {ocupado ? 'Probando…' : 'Probar de nuevo'}
          </button>
        </div>
        {pruebas && (
          <ul className="diagnostico">
            {pruebas.map((p, i) => (
              <li key={i} className={`diag-${p.estado}`}>
                <span className="diag-marca">{p.estado === 'ok' ? 'OK' : p.estado === 'aviso' ? 'AVISO' : 'FALLA'}</span>
                <span className="diag-grupo">{p.grupo}</span>
                <span>
                  <b>{p.nombre}</b> · {p.detalle}
                  {p.ayuda && <em>{p.ayuda}</em>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function Ajustes({ perfil, alCambiar, verRecorrido, inicial = 'cuentas' }: { perfil: PerfilVista | null; alCambiar: () => void; verRecorrido: () => void; inicial?: PestanaAjustes }) {
  const [tab, setTab] = useState<PestanaAjustes>(inicial);
  useEffect(() => setTab(inicial), [inicial]);
  return (
    <div className="columna ancha">
      <div className="cabecera-ajustes">
        <h2>Ajustes</h2>
        <button className="boton secundario" onClick={verRecorrido}>
          Ver recorrido
        </button>
      </div>
      <div className="segmentos-v ancho">
        {PESTANAS.map((p) => (
          <button key={p.id} className={tab === p.id ? 'activo' : ''} onClick={() => setTab(p.id)}>
            {p.nombre}
          </button>
        ))}
      </div>
      {tab === 'cuentas' && <TabCuentas alCambiar={alCambiar} />}
      {tab === 'modelos' && <TabModelos perfil={perfil} alCambiar={alCambiar} />}
      {tab === 'ahorro' && <TabAhorro />}
      {tab === 'automatico' && <TabAutomatico />}
      {tab === 'actualizar' && <Actualizaciones />}
      {tab === 'diagnostico' && <TabDiagnostico />}
    </div>
  );
}
