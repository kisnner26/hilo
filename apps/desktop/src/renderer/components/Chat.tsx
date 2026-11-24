import { useEffect, useRef, useState } from 'react';
import { api, type AdjuntoVista, type EstadoMotores, type TarjetaVista } from '../lib/api';
import { alPedirDictado, alPreguntarAlAgente, irASeccion, type PedidoAgente } from '../lib/agente';
import { MENSAJE_ERROR, useDictado } from '../lib/useDictado';
import { NOMBRE_IDIOMA, PanelVoz, SelectorIdioma } from './Voz';
import { mdAHtml } from '../lib/markdown';

type Mensaje =
  | { id: number; de: 'yo'; texto: string; adjuntos?: { nombre: string; vista?: string }[] }
  | { id: number; de: 'asistente'; texto: string; tarjetas?: TarjetaVista[]; pregunta?: string; escribiendo?: boolean; error?: boolean; modelo?: string; ms?: number; tokens?: number; local?: boolean; accion?: 'piloto' };

const SUGERENCIAS: { t: string; sub: string; icono: string }[] = [
  { t: '¿Qué tarea tengo?', sub: 'Tus tareas de ClickUp', icono: 'M5 6h14M5 12h14M5 18h9' },
  { t: '¿Qué hago hoy?', sub: 'Lo más urgente primero', icono: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 100 8 4 4 0 000-8z' },
  { t: '¿Quién me bloquea?', sub: 'Y cómo destrabarlo', icono: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z' },
  { t: 'Hazme mis pendientes', sub: 'El piloto automático', icono: 'M13 3L5 14h6l-1 7 8-11h-6z' },
  { t: '¿Cuáles son mis PR?', sub: 'Estado y revisión', icono: 'M6 6v12M18 9v4a4 4 0 01-4 4h-3M6 6a2 2 0 100-.01M18 9a2 2 0 100-.01' },
  { t: 'Explícame cómo está organizado el proyecto', sub: 'Un mapa rápido', icono: 'M6 7a2 2 0 100-.01M18 6a2 2 0 100-.01M12 17a2 2 0 100-.01M8 8l3 7M16 8l-3 7' },
];
const ROTULO: Record<string, string> = { entender: 'Entenderla', hacer: 'Hacerla', revisar: 'Revisarla', bloqueo: 'Escribir el bloqueo' };
const PEDIDO: Record<string, string> = { entender: 'Entender', hacer: 'Hacer', revisar: 'Revisar', bloqueo: 'Escribir el bloqueo de' };

let contador = 0;
const nuevoId = () => ++contador;

/** Chat libre con el agente del rol de la persona. Conoce sus tareas de ClickUp y sus PR de GitHub. */
export function Chat({ rol, saludo }: { rol?: string; saludo?: string }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [conv, setConv] = useState(() => `c${Date.now()}`);
  const fin = useRef<HTMLDivElement>(null);
  const [motor, setMotor] = useState<EstadoMotores | null>(null);
  const [adjuntos, setAdjuntos] = useState<AdjuntoVista[]>([]);
  const [preparando, setPreparando] = useState(0);
  const [errorAdj, setErrorAdj] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const selector = useRef<HTMLInputElement>(null);
  const agregar = async (archivos: File[]) => {
    if (archivos.length === 0) return;
    setErrorAdj('');
    for (const f of archivos.slice(0, 8)) {
      setPreparando((n) => n + 1);
      try {
        const a = await api.adjuntoPreparar(f.name || 'pegado.png', new Uint8Array(await f.arrayBuffer()));
        setAdjuntos((l) => (l.some((x) => x.id === a.id) ? l : [...l, a]));
      } catch (e) {
        setErrorAdj(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      } finally {
        setPreparando((n) => n - 1);
      }
    }
  };
  const cambiarModo = async (a: AdjuntoVista, modo: AdjuntoVista['modo']) => {
    const n = await api.adjuntoModo(a.id, modo);
    setAdjuntos((l) => l.map((x) => (x.id === a.id ? (n ?? { ...x, modo, tokensEnviados: modo === 'imagen' ? x.tokensEnviados : Math.min(x.tokensOriginal, 1500) }) : x)));
  };

  useEffect(() => void api.motorEstado().then(setMotor).catch(() => undefined), []);
  const [autoEnvio, setAutoEnvio] = useState(() => {
    try {
      return localStorage.getItem('hilo.dictado-auto') !== 'no';
    } catch {
      return true;
    }
  });
  const base = useRef('');
  const autoRef = useRef(autoEnvio);
  autoRef.current = autoEnvio;
  const preguntarRef = useRef<(t: string) => void>(() => undefined);
  const dictado = useDictado((t, final) => {
    const junto = `${base.current}${base.current && t ? ' ' : ''}${t}`.trim();
    setTexto(junto);
    if (final && junto && autoRef.current) {
      base.current = '';
      preguntarRef.current(junto);
    }
  });
  const alternarMic = () => {
    if (dictado.fase === 'inactivo') base.current = texto.trim();
    dictado.alternar();
  };
  const alternarMicRef = useRef(alternarMic);
  alternarMicRef.current = alternarMic;
  useEffect(() => alPedirDictado(() => alternarMicRef.current()), []);
  const cambiarAuto = (v: boolean) => {
    setAutoEnvio(v);
    try {
      localStorage.setItem('hilo.dictado-auto', v ? 'si' : 'no');
    } catch {
      /* sin almacenamiento */
    }
  };
  const abierta = useRef(conv);
  abierta.current = conv;

  useEffect(
    () =>
      api.alChat((e) => {
        if (e.conv !== abierta.current) return;
        setMensajes((ms) => {
          const resto = ms.slice(0, -1);
          const ultimo = ms[ms.length - 1];
          if (!ultimo || ultimo.de !== 'asistente') return ms;
          if (e.tipo === 'respuesta') return [...resto, { ...ultimo, texto: e.texto ?? '', tarjetas: e.tarjetas, pregunta: e.pregunta, escribiendo: false, local: true, ...(e.accion ? { accion: e.accion } : {}) }];
          if (e.tipo === 'inicio') return [...resto, { ...ultimo, modelo: e.modelo }];
          if (e.tipo === 'delta') return [...resto, { ...ultimo, texto: ultimo.texto + (e.texto ?? '') }];
          if (e.tipo === 'fin') return [...resto, { ...ultimo, texto: e.texto || ultimo.texto, escribiendo: false, ms: e.ms, ...(e.tokens ? { tokens: e.tokens } : {}) }];
          if (e.tipo === 'error') return [...resto, { ...ultimo, texto: e.texto ?? 'Algo falló.', escribiendo: false, error: true }];
          return ms;
        });
        if (e.tipo === 'respuesta' || e.tipo === 'fin' || e.tipo === 'error') setOcupado(false);
      }),
    [],
  );
  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [mensajes]);

  const enviar = (mostrar: string, pedido: { texto?: string; tarea?: { accion: string; ref: string } }, conAdjuntos = false) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      localStorage.setItem('hilo.pregunto', '1');
    } catch {
      /* sin almacenamiento */
    }
    const lista = conAdjuntos ? adjuntos : [];
    setMensajes((ms) => [...ms, { id: nuevoId(), de: 'yo', texto: mostrar, ...(lista.length ? { adjuntos: lista.map((a) => ({ nombre: a.nombre, ...(a.vista ? { vista: a.vista } : {}) })) } : {}) }, { id: nuevoId(), de: 'asistente', texto: '', escribiendo: true }]);
    api.chatEnviar({ conv, ...pedido, ...(lista.length ? { adjuntos: lista.map((a) => a.id) } : {}) });
    if (conAdjuntos) setAdjuntos([]);
  };
  const preguntar = (t: string) => {
    const limpio = t.trim();
    if (!limpio && adjuntos.length === 0) return;
    setTexto('');
    enviar(limpio || 'Analiza lo que adjunté.', { texto: limpio }, true);
  };
  preguntarRef.current = preguntar;
  const pendiente = useRef<PedidoAgente | null>(null);
  const lanzar = (p: PedidoAgente) => {
    if (p.tarea) enviar(p.mostrar, { tarea: p.tarea });
    else enviar(p.mostrar, { texto: p.texto ?? p.mostrar });
  };
  const lanzarRef = useRef(lanzar);
  lanzarRef.current = lanzar;
  useEffect(
    () =>
      alPreguntarAlAgente((p) => {
        pendiente.current = p;
        if (!ocupadoRef.current) {
          pendiente.current = null;
          lanzarRef.current(p);
        }
      }),
    [],
  );
  const ocupadoRef = useRef(ocupado);
  ocupadoRef.current = ocupado;
  useEffect(() => {
    if (!ocupado && pendiente.current) {
      const p = pendiente.current;
      pendiente.current = null;
      lanzarRef.current(p);
    }
  }, [ocupado]);
  const largo = mensajes.length >= 16 && !ocupado;
  const retomar = async () => {
    const r = await api.sesionNueva();
    void api.chatNueva(conv);
    setConv(`c${Date.now()}`);
    setMensajes([]);
    setOcupado(false);
    setTimeout(() => lanzarRef.current({ mostrar: 'Retomar con un resumen', texto: r.texto }), 0);
  };
  const nueva = () => {
    void api.chatNueva(conv);
    setConv(`c${Date.now()}`);
    setMensajes([]);
    setOcupado(false);
  };

  return (
    <div
      className={`chat${arrastrando ? ' arrastrando' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setArrastrando(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        void agregar([...e.dataTransfer.files]);
      }}
    >
      {arrastrando && <div className="soltar-aqui">Suelta aquí para adjuntar imágenes y archivos</div>}
      <header className="chat-cabeza">
        <div className="titulo-chat">
          <h2>Asistente</h2>
          <span className="chips-linea">
            {rol && <span className="dist">{rol}</span>}
            {saludo && <span className="dist">{saludo}</span>}
            {motor && (
              <button className={`dist chip-motor${motor.lista.find((m) => m.id === motor.elegido)?.local ? ' local' : ''}`} onClick={() => irASeccion('ajustes')} title="La IA que responde. Cámbiala en Ajustes › Modelos.">
                {motor.lista.find((m) => m.id === motor.elegido)?.nombre ?? 'IA'}
              </button>
            )}
          </span>
        </div>
        <button className="boton secundario" onClick={nueva}>
          Nueva conversación
        </button>
      </header>

      {largo && (
        <div className="aviso-largo">
          <span>Esta conversación ya es larga: cada mensaje nuevo arrastra todo lo anterior y gasta más.</span>
          <button className="boton secundario" onClick={() => void retomar()}>
            Seguir en una nueva con resumen
          </button>
        </div>
      )}
      <div className="chat-mensajes">
        {mensajes.length === 0 && (
          <div className="chat-vacio">
            <h3>{saludo ? `Hola, ${saludo}` : 'Hola'}. ¿En qué te ayudo?</h3>
            <p className="suave subtitulo-vacio">Escribe o toca el micrófono y habla. Lo que Hilo ya sabe de ti lo responde sin gastar tokens.</p>
            <div className="sugerencias">
              {SUGERENCIAS.map((x) => (
                <button key={x.t} className="sugerencia" onClick={() => preguntar(x.t)}>
                  <svg className="ic-sug" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={x.icono} />
                  </svg>
                  <b>{x.t}</b>
                  <span>{x.sub}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {mensajes.map((m) =>
          m.de === 'yo' ? (
            <div key={m.id} className="burbuja yo">
              {m.adjuntos && m.adjuntos.length > 0 && (
                <div className="adjuntos-enviados">
                  {m.adjuntos.map((a) => (
                    <span key={a.nombre} className="adjunto-enviado" title={a.nombre}>
                      {a.vista ? <img src={a.vista} alt="" /> : <i aria-hidden="true">▤</i>}
                      <em>{a.nombre}</em>
                    </span>
                  ))}
                </div>
              )}
              {m.texto}
            </div>
          ) : (
            <div key={m.id} className={`burbuja asistente${m.error ? ' con-error' : ''}`}>
              {m.escribiendo && !m.texto ? <span className="puntos-pensando" aria-label="Pensando"><i /><i /><i /></span> : <div className="md" dangerouslySetInnerHTML={{ __html: mdAHtml(m.texto) }} />}
              {m.tarjetas && m.tarjetas.length > 0 && (
                <div className="tarjetas-chat">
                  {m.tarjetas.map((t) => (
                    <div key={`${t.tipo}${t.ref}${t.titulo}`} className="tarjeta-chat">
                      <div>
                        <strong>{t.titulo}</strong>
                        <span className="suave">{t.detalle}</span>
                      </div>
                      <div className="botones-accion">
                        {t.acciones.map((a) => (
                          <button key={a} className="boton secundario" disabled={ocupado} onClick={() => enviar(`${PEDIDO[a]} ${t.tipo === 'pr' ? `el PR #${t.ref}` : t.ref}`, { tarea: { accion: a, ref: t.ref } })}>
                            {ROTULO[a]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {m.pregunta && <p className="pregunta-chat">{m.pregunta}</p>}
              {m.accion === 'piloto' && (
                <div className="fila">
                  <button
                    className="boton"
                    onClick={() => {
                      void api.autoCorrer().then(() => irASeccion('inicio')).catch(() => irASeccion('inicio'));
                    }}
                  >
                    Hacer mis pendientes
                  </button>
                  <span className="suave">Verás el avance en Mi día.</span>
                </div>
              )}
              {!m.escribiendo && m.texto && (
                <div className="pie-burbuja">
                  <button className="enlace" onClick={() => void api.copiar(m.texto)}>
                    Copiar
                  </button>
                  {m.local && <span className="etiqueta-cero">Sin gastar tokens</span>}
                  {m.tokens ? <span className="suave">{m.tokens.toLocaleString('es')} tokens</span> : null}
                  {m.modelo && <span className="suave">{m.modelo}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ''}</span>}
                </div>
              )}
            </div>
          ),
        )}
        <div ref={fin} />
      </div>

      {(dictado.fase !== 'inactivo' || dictado.error) && (
        <div className={`estado-voz${dictado.error ? ' con-error' : ''}`}>
          {dictado.error ? (
            <>
              <span>{MENSAJE_ERROR[dictado.error] ?? 'No se pudo dictar.'}</span>
              {(dictado.error === 'permiso-microfono' || dictado.error === 'permiso-voz' || dictado.error === 'sin-microfono') && (
                <button className="enlace" onClick={() => void api.dictadoPermisos(dictado.error === 'permiso-voz' ? 'voz' : 'microfono')}>
                  Abrir los permisos del sistema
                </button>
              )}
              <button className="enlace" onClick={dictado.limpiarError}>
                Cerrar
              </button>
            </>
          ) : (
            <>
              <span className="punto-voz" aria-hidden="true" />
              <span>
                {dictado.fase === 'iniciando' ? 'Preparando el micrófono…' : dictado.fase === 'cerrando' ? 'Escribiendo lo que dijiste…' : autoEnvio ? 'Te escucho. Cuando hagas una pausa larga, envío tu pregunta.' : 'Te escucho. Toca el micrófono para terminar.'}
                {dictado.detectado && dictado.idioma === 'auto' ? ` · ${NOMBRE_IDIOMA[dictado.detectado] ?? dictado.detectado}` : ''}
              </span>
              <SelectorIdioma valor={dictado.idioma} alCambiar={dictado.cambiarIdioma} motor={dictado.motor} />
              <label className="auto-voz">
                <input type="checkbox" checked={autoEnvio} onChange={(e) => cambiarAuto(e.target.checked)} /> Enviar al terminar
              </label>
            </>
          )}
        </div>
      )}
      {dictado.fase === 'inactivo' && !dictado.error && dictado.plataforma !== '' && dictado.motor !== 'whisper' && (
        <details className="mejorar-voz">
          <summary>{dictado.motor === 'ninguno' ? 'Activar el dictado por voz' : 'Mejorar el dictado: inglés y español sin elegir'}</summary>
          <PanelVoz estado={dictado.estado} refrescar={dictado.refrescar} />
        </details>
      )}
      {(adjuntos.length > 0 || preparando > 0 || errorAdj) && (
        <div className="adjuntos-lista">
          {adjuntos.map((a) => {
            const ahorro = a.tokensOriginal > 0 ? Math.round((1 - a.tokensEnviados / a.tokensOriginal) * 100) : 0;
            return (
              <div key={a.id} className="adjunto">
                {a.vista ? <img src={a.vista} alt="" /> : <span className="icono-archivo" aria-hidden="true">{a.formato.slice(0, 4)}</span>}
                <div className="adjunto-datos">
                  <b title={a.nombre}>{a.nombre}</b>
                  <span>
                    {a.metodo} · <strong>~{a.tokensEnviados.toLocaleString('es')} tokens</strong>
                    {ahorro >= 10 && <em className="ahorro-adjunto"> −{ahorro} %</em>}
                  </span>
                  {a.aviso && <span className="aviso-adjunto">{a.aviso}</span>}
                </div>
                {a.modos.length > 1 && (
                  <span className="selector-idioma" role="group" aria-label="Cómo se manda">
                    {a.modos.map((m) => (
                      <button key={m} type="button" className={a.modo === m ? 'activo' : ''} onClick={() => void cambiarModo(a, m)} title={m === 'texto' ? 'Mandar solo el texto leído en tu equipo: cuesta mucho menos' : m === 'imagen' ? 'Mandar la imagen para que el agente la vea' : 'Que el agente lea el archivo'}>
                        {m === 'texto' ? 'Texto' : m === 'imagen' ? 'Imagen' : 'Archivo'}
                      </button>
                    ))}
                  </span>
                )}
                <button type="button" className="quitar-adjunto" onClick={() => setAdjuntos((l) => l.filter((x) => x.id !== a.id))} aria-label={`Quitar ${a.nombre}`}>
                  ×
                </button>
              </div>
            );
          })}
          {preparando > 0 && <div className="adjunto preparando">Leyendo {preparando === 1 ? 'el archivo' : `${preparando} archivos`} en tu equipo…</div>}
          {errorAdj && <div className="adjunto con-error">{errorAdj}</div>}
        </div>
      )}
      <form
        className="compositor"
        onSubmit={(e) => {
          e.preventDefault();
          preguntar(texto);
        }}
      >
        <input ref={selector} type="file" multiple hidden onChange={(e) => { void agregar([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <button type="button" className="clip" onClick={() => selector.current?.click()} title="Adjuntar imágenes, PDF, documentos o cualquier archivo" aria-label="Adjuntar archivos">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.9 1.9 0 01-2.6-2.6l8.2-8.2" />
          </svg>
        </button>
        <textarea
          onPaste={(e) => {
            const archivos = [...e.clipboardData.files];
            if (archivos.length > 0) {
              e.preventDefault();
              void agregar(archivos);
            }
          }}
          value={texto}
          rows={1}
          placeholder={dictado.fase === 'escuchando' ? 'Habla, te estoy escuchando…' : 'Pregunta, habla o adjunta imágenes y archivos…'}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              preguntar(texto);
            }
          }}
        />
        {dictado.plataforma !== '' && (
          <button
            type="button"
            className={`microfono${dictado.fase !== 'inactivo' ? ' activo' : ''}`}
            style={{ ['--nivel' as string]: dictado.nivel }}
            onClick={alternarMic}
            disabled={!dictado.disponible && dictado.plataforma === 'darwin'}
            title={dictado.fase !== 'inactivo' ? 'Terminar de dictar' : dictado.disponible ? 'Dictar con la voz' : dictado.plataforma === 'win32' ? 'Usa el dictado de Windows: Win+H' : 'El dictado por voz está en la versión de Mac'}
            aria-label="Dictar con la voz"
            aria-pressed={dictado.fase !== 'inactivo'}
          >
            {dictado.fase === 'escuchando' ? (
              <span className="ondas" aria-hidden="true"><i /><i /><i /><i /></span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" />
              </svg>
            )}
          </button>
        )}
        <button className="enviar" type="submit" disabled={ocupado || preparando > 0 || (!texto.trim() && adjuntos.length === 0)} aria-label="Enviar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
