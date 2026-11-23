import { useEffect, useState } from 'react';
import { api, type Conexion, type MiDiaVista, type PrVista, type Sugerencia } from '../lib/api';

const ROTULO: Record<Sugerencia['tipo'], string> = {
  ci: 'CI',
  formato: 'Formato',
  'revision-recibida': 'Cambios',
  bloqueo: 'Bloqueo',
  vencida: 'Vencida',
  'abrir-pr': 'Abrir PR',
  entrega: 'Entrega',
  revisar: 'Revisar',
  espera: 'Espera',
};

function Estado({ pr }: { pr: PrVista }) {
  return (
    <span className="distintivos">
      <span className={`dist ${pr.ci === 'ok' ? 'ok' : pr.ci === 'fallo' ? 'mal' : 'pend'}`}>CI {pr.ci}</span>
      {pr.borrador && <span className="dist">borrador</span>}
    </span>
  );
}

function Accion({ a, dia, abrirRevision }: { a: Sugerencia; dia: MiDiaVista; abrirRevision: (n: string) => void }) {
  const [texto, setTexto] = useState(a.preparado ?? '');
  const [abierta, setAbierta] = useState(false);
  const [msg, setMsg] = useState('');
  const tarea = dia.tareas.find((t) => t.codigo === a.ref);
  const pr = /^#\d+$/.test(a.ref) ? a.ref.slice(1) : undefined;
  const publicar = async () => {
    if (!tarea) return;
    try {
      const r = await api.publicarClickup(tarea.id, texto);
      setMsg(r.publicado ? 'Publicado' : 'Cancelado');
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  };
  return (
    <li className={`accion p${Math.min(a.prioridad, 6)}`}>
      <div className="accion-cabeza">
        <span className="etiqueta-tipo">{ROTULO[a.tipo]}</span>
        <span className="texto-accion">{a.texto}</span>
        <span className="botones-accion">
          {pr && ['revisar', 'formato', 'revision-recibida', 'ci'].includes(a.tipo) && (
            <button className="boton secundario" onClick={() => abrirRevision(pr)}>
              Abrir
            </button>
          )}
          {a.preparado && (
            <button className="boton secundario" onClick={() => setAbierta(!abierta)}>
              {abierta ? 'Cerrar' : 'Preparar'}
            </button>
          )}
          {a.tipo === 'abrir-pr' && (
            <button className="boton secundario" onClick={() => void api.copiar(`git switch -c feature/${(dia.saludo || 'yo').toLowerCase()}-${a.ref}`)}>
              Copiar rama
            </button>
          )}
        </span>
      </div>
      {abierta && a.preparado && (
        <div className="preparado">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8} />
          <div className="fila">
            <button className="boton" onClick={() => void publicar()} disabled={/FALTA/.test(texto) || !tarea}>
              Publicar en ClickUp
            </button>
            <button className="boton secundario" onClick={() => void api.copiar(texto)}>
              Copiar
            </button>
            {/FALTA/.test(texto) && <span className="suave">Completa lo marcado con FALTA.</span>}
            {msg && <span className="suave">{msg}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

export function Inicio({ abrirRevision, version, conectar }: { abrirRevision: (n: string) => void; version: number; conectar: () => void }) {
  const [con, setCon] = useState<Conexion | null>(null);
  const [dia, setDia] = useState<MiDiaVista | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [cuenta, setCuenta] = useState(0);

  useEffect(() => {
    let vivo = true;
    void api.conexion().then(async (c) => {
      if (!vivo) return;
      setCon(c);
      if (!c.github.conectado && !c.clickup.conectado) return;
      setCargando(true);
      try {
        const r = await api.miDia();
        if (vivo) {
          setDia(r.dia);
          setAvisos(r.avisosDeConexion);
        }
      } finally {
        if (vivo) setCargando(false);
      }
    });
    return () => {
      vivo = false;
    };
  }, [version, cuenta]);

  if (!con) return <div className="columna ancha"><div className="esqueletos">{[0, 1, 2].map((i) => <div key={i} className="esqueleto" />)}</div></div>;
  if (!con.github.conectado && !con.clickup.conectado) {
    return (
      <div className="columna ancha">
        <div className="estado-vacio grande">
          <p>Conecta GitHub y ClickUp para ver tu día</p>
          <button className="boton" onClick={conectar}>
            Conectar ahora
          </button>
        </div>
      </div>
    );
  }
  const urgentes = dia?.acciones.filter((a) => a.prioridad <= 3).length ?? 0;
  return (
    <div className="columna ancha">
      <div className="cabecera-dia">
        <div>
          <h2>Hola, {dia?.saludo ?? '…'}</h2>
          <span className="chips-linea">
            <span className="dist">{dia?.rol ?? '…'}</span>
            <span className="dist">{con.repo}</span>
          </span>
        </div>
        <button className="boton secundario" onClick={() => setCuenta((x) => x + 1)} disabled={cargando}>
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
      {avisos.map((a) => (
        <p key={a} className="mal">
          {a}
        </p>
      ))}

      {cargando && !dia && <div className="esqueletos">{[0, 1, 2].map((i) => <div key={i} className="esqueleto" />)}</div>}
      {dia && (
        <>
          <div className="stats">
            <div className="stat">
              <strong>{dia.tareas.length}</strong>
              <span>tareas</span>
            </div>
            <div className="stat">
              <strong>{dia.prs.length}</strong>
              <span>PR tuyos</span>
            </div>
            <div className={`stat${urgentes ? ' alerta' : ''}`}>
              <strong>{urgentes}</strong>
              <span>urgentes</span>
            </div>
            {dia.rol === 'integrador' && (
              <div className="stat">
                <strong>{dia.paraRevisar.length}</strong>
                <span>por revisar</span>
              </div>
            )}
          </div>

          <h3>Ahora</h3>
          {dia.acciones.length === 0 ? <p className="bien">Todo al día.</p> : (
            <ul className="acciones">
              {dia.acciones.slice(0, 8).map((a) => (
                <Accion key={`${a.tipo}${a.ref}`} a={a} dia={dia} abrirRevision={abrirRevision} />
              ))}
            </ul>
          )}

          <div className="dos-listas">
            <section>
              <h3>Mis tareas</h3>
              {dia.tareas.length === 0 ? <p className="vacio-chico">Sin tareas abiertas.</p> : (
                <ul className="lista-compacta">
                  {dia.tareas.map((t) => (
                    <li key={t.id}>
                      <span className="mono codigo">{t.codigo}</span>
                      <span className="nombre">{t.nombre.replace(/^[A-Z0-9-]+\s*[—–-]\s*/, '')}</span>
                      <span className="dist">{t.estado}</span>
                      {t.vence && <span className={`dist ${new Date(t.vence) < new Date() ? 'mal' : ''}`}>{t.vence.slice(5, 10)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>{dia.rol === 'integrador' ? 'PR por revisar' : 'Mis PR'}</h3>
              {(dia.rol === 'integrador' ? dia.paraRevisar : dia.prs).length === 0 ? <p className="vacio-chico">Ninguno.</p> : (
                <ul className="lista-compacta">
                  {(dia.rol === 'integrador' ? dia.paraRevisar : dia.prs).slice(0, 10).map((p) => (
                    <li key={p.numero}>
                      <button className="enlace" onClick={() => abrirRevision(String(p.numero))}>
                        #{p.numero}
                      </button>
                      <span className="nombre">{p.titulo}</span>
                      <Estado pr={p} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
