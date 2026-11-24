import { useEffect, useRef, useState } from 'react';
import { api, type TarjetaVista } from '../lib/api';
import { alPreguntarAlAgente, type PedidoAgente } from '../lib/agente';
import { mdAHtml } from '../lib/markdown';

type Mensaje =
  | { id: number; de: 'yo'; texto: string }
  | { id: number; de: 'asistente'; texto: string; tarjetas?: TarjetaVista[]; pregunta?: string; escribiendo?: boolean; error?: boolean; modelo?: string; ms?: number; tokens?: number; local?: boolean };

const SUGERENCIAS: { t: string; sub: string }[] = [
  { t: '¿Qué tarea tengo?', sub: 'Tus tareas de ClickUp' },
  { t: '¿Qué hago hoy?', sub: 'Lo más urgente primero' },
  { t: '¿Cuáles son mis PR?', sub: 'Estado y revisión' },
  { t: 'Explícame cómo está organizado el proyecto', sub: 'Un mapa rápido' },
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
          if (e.tipo === 'respuesta') return [...resto, { ...ultimo, texto: e.texto ?? '', tarjetas: e.tarjetas, pregunta: e.pregunta, escribiendo: false, local: true }];
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

  const enviar = (mostrar: string, pedido: { texto?: string; tarea?: { accion: string; ref: string } }) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      localStorage.setItem('hilo.pregunto', '1');
    } catch {
      /* sin almacenamiento */
    }
    setMensajes((ms) => [...ms, { id: nuevoId(), de: 'yo', texto: mostrar }, { id: nuevoId(), de: 'asistente', texto: '', escribiendo: true }]);
    api.chatEnviar({ conv, ...pedido });
  };
  const preguntar = (t: string) => {
    const limpio = t.trim();
    if (!limpio) return;
    setTexto('');
    enviar(limpio, { texto: limpio });
  };
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
    <div className="chat">
      <header className="chat-cabeza">
        <div className="titulo-chat">
          <h2>Asistente</h2>
          <span className="chips-linea">
            {rol && <span className="dist">{rol}</span>}
            {saludo && <span className="dist">{saludo}</span>}
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
            <h3>¿En qué te ayudo?</h3>
            <div className="sugerencias">
              {SUGERENCIAS.map((x) => (
                <button key={x.t} className="sugerencia" onClick={() => preguntar(x.t)}>
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

      <form
        className="compositor"
        onSubmit={(e) => {
          e.preventDefault();
          preguntar(texto);
        }}
      >
        <textarea
          value={texto}
          rows={1}
          placeholder="Pregunta lo que quieras…"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              preguntar(texto);
            }
          }}
        />
        <button className="enviar" type="submit" disabled={ocupado || !texto.trim()} aria-label="Enviar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
