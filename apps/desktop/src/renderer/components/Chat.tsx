import { useEffect, useRef, useState } from 'react';
import { api, type TarjetaVista } from '../lib/api';
import { mdAHtml } from '../lib/markdown';

type Mensaje =
  | { id: number; de: 'yo'; texto: string }
  | { id: number; de: 'asistente'; texto: string; tarjetas?: TarjetaVista[]; pregunta?: string; escribiendo?: boolean; error?: boolean; modelo?: string; ms?: number };

const SUGERENCIAS = ['¿Qué tarea tengo?', '¿Qué hago hoy?', '¿Cuáles son mis PR?', 'Explícame cómo está organizado el proyecto'];
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
          if (e.tipo === 'respuesta') return [...resto, { ...ultimo, texto: e.texto ?? '', tarjetas: e.tarjetas, pregunta: e.pregunta, escribiendo: false }];
          if (e.tipo === 'inicio') return [...resto, { ...ultimo, modelo: e.modelo }];
          if (e.tipo === 'delta') return [...resto, { ...ultimo, texto: ultimo.texto + (e.texto ?? '') }];
          if (e.tipo === 'fin') return [...resto, { ...ultimo, texto: e.texto || ultimo.texto, escribiendo: false, ms: e.ms }];
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
    setMensajes((ms) => [...ms, { id: nuevoId(), de: 'yo', texto: mostrar }, { id: nuevoId(), de: 'asistente', texto: '', escribiendo: true }]);
    api.chatEnviar({ conv, ...pedido });
  };
  const preguntar = (t: string) => {
    const limpio = t.trim();
    if (!limpio) return;
    setTexto('');
    enviar(limpio, { texto: limpio });
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
        <div>
          <h2>Asistente</h2>
          <p className="suave">
            {saludo ? `${saludo} · ` : ''}
            {rol ? `rol ${rol} · ` : ''}conoce tus tareas de ClickUp y tus PR de GitHub. Pregúntale lo que quieras del proyecto.
          </p>
        </div>
        <button className="boton secundario" onClick={nueva}>
          Nueva conversación
        </button>
      </header>

      <div className="chat-mensajes">
        {mensajes.length === 0 && (
          <div className="chat-vacio">
            <p className="suave">Empieza con una pregunta o toca una sugerencia:</p>
            <div className="chips">
              {SUGERENCIAS.map((s) => (
                <button key={s} className="chip" onClick={() => preguntar(s)}>
                  {s}
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
              {m.escribiendo && !m.texto ? <span className="pensando">Pensando…</span> : <div className="md" dangerouslySetInnerHTML={{ __html: mdAHtml(m.texto) }} />}
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
                  {m.modelo && <span className="suave">{m.modelo}{m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ''}</span>}
                </div>
              )}
            </div>
          ),
        )}
        <div ref={fin} />
      </div>

      <form
        className="chat-entrada"
        onSubmit={(e) => {
          e.preventDefault();
          preguntar(texto);
        }}
      >
        <textarea
          value={texto}
          rows={2}
          placeholder="Escribe tu pregunta… (Enter envía, Shift+Enter hace un salto de línea)"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              preguntar(texto);
            }
          }}
        />
        <button className="boton" type="submit" disabled={ocupado || !texto.trim()}>
          {ocupado ? 'Respondiendo…' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
