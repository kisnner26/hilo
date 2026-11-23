import { useEffect, useState } from 'react';
import { api, type Conexion, type MiDiaVista, type PrVista, type Sugerencia } from '../lib/api';
import { Conexiones } from './Conexiones';

const NOMBRE_TIPO: Record<Sugerencia['tipo'], string> = {
  ci: 'CI',
  formato: 'Formato',
  'revision-recibida': 'Revisión',
  bloqueo: 'Bloqueo',
  vencida: 'Vencida',
  'abrir-pr': 'Abrir PR',
  entrega: 'Entrega',
  revisar: 'Revisar',
  espera: 'Espera',
};

function Distintivo({ pr }: { pr: PrVista }) {
  return (
    <span className="distintivos">
      <span className={`dist ${pr.ci === 'ok' ? 'ok' : pr.ci === 'fallo' ? 'mal' : 'pend'}`}>CI {pr.ci}</span>
      <span className={`dist ${pr.revision === 'aprobado' ? 'ok' : pr.revision === 'cambios' ? 'mal' : 'pend'}`}>{pr.revision}</span>
      {pr.borrador && <span className="dist pend">borrador</span>}
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
      setMsg(r.publicado ? 'Publicado en ClickUp.' : 'No se publicó.');
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  };
  return (
    <li className={`accion p${Math.min(a.prioridad, 6)}`}>
      <div className="accion-cabeza">
        <span className="etiqueta-tipo">{NOMBRE_TIPO[a.tipo]}</span>
        <span>{a.texto}</span>
        <span className="botones-accion">
          {pr && (a.tipo === 'revisar' || a.tipo === 'formato' || a.tipo === 'revision-recibida' || a.tipo === 'ci') && (
            <button className="boton secundario" onClick={() => abrirRevision(pr)}>
              {a.tipo === 'revisar' ? 'Revisar' : 'Ver qué corregir'}
            </button>
          )}
          {a.preparado && (
            <button className="boton secundario" onClick={() => setAbierta(!abierta)}>
              {abierta ? 'Cerrar' : 'Preparar comentario'}
            </button>
          )}
          {a.tipo === 'abrir-pr' && (
            <button className="boton secundario" onClick={() => void api.copiar(`git switch -c feature/${(dia.saludo || 'yo').toLowerCase()}-${a.ref}`)}>
              Copiar nombre de rama
            </button>
          )}
        </span>
      </div>
      {abierta && a.preparado && (
        <div className="preparado">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={9} />
          <div className="fila">
            <button className="boton" onClick={() => void publicar()} disabled={/FALTA/.test(texto) || !tarea}>
              Publicar en ClickUp
            </button>
            <button className="boton secundario" onClick={() => void api.copiar(texto)}>
              Copiar
            </button>
            {/FALTA/.test(texto) && <span className="suave">Completa los campos marcados con FALTA (por ejemplo el SHA).</span>}
          </div>
          {msg && <p className="suave">{msg}</p>}
        </div>
      )}
    </li>
  );
}

export function Inicio({ abrirRevision, version }: { abrirRevision: (n: string) => void; version: number }) {
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

  if (!con) return <div className="columna ancha"><p className="suave">Cargando…</p></div>;
  const completo = con.github.conectado && con.clickup.conectado;
  return (
    <div className="columna ancha">
      {!completo && (
        <>
          <h2>Conecta tus cuentas</h2>
          <p className="suave">Con GitHub y ClickUp conectados, Hilo sabe quién eres y te muestra tus tareas, tus PR y qué hacer ahora. No hay nada más que configurar.</p>
          <Conexiones alCambiar={() => setCuenta((x) => x + 1)} />
        </>
      )}
      {dia && (
        <>
          <div className="cabecera-dia">
            <div>
              <h2>Hola, {dia.saludo}</h2>
              <p className="suave">
                Rol: {dia.rol} · {con.repo}
              </p>
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

          <h3>Qué hacer ahora</h3>
          {dia.acciones.length === 0 ? <p className="bien">Nada urgente. Todo lo tuyo está al día.</p> : (
            <ul className="acciones">
              {dia.acciones.map((a) => (
                <Accion key={`${a.tipo}${a.ref}`} a={a} dia={dia} abrirRevision={abrirRevision} />
              ))}
            </ul>
          )}

          <h3>Mis tareas ({dia.tareas.length})</h3>
          {dia.tareas.length === 0 ? <p className="suave">No tienes tareas abiertas asignadas.</p> : (
            <table className="tabla">
              <tbody>
                {dia.tareas.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.codigo}</td>
                    <td>{t.nombre.replace(/^[A-Z0-9-]+\s*[—–-]\s*/, '')}</td>
                    <td>{t.estado}</td>
                    <td>{t.vence ? t.vence.slice(0, 10) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>Mis PR ({dia.prs.length})</h3>
          {dia.prs.length === 0 ? <p className="suave">No tienes PR abiertos.</p> : (
            <ul className="lista-pr">
              {dia.prs.map((p) => (
                <li key={p.numero}>
                  <button className="enlace" onClick={() => abrirRevision(String(p.numero))}>
                    #{p.numero}
                  </button>{' '}
                  {p.titulo} <Distintivo pr={p} />
                </li>
              ))}
            </ul>
          )}

          {dia.paraRevisar.length > 0 && (
            <>
              <h3>Para revisar ({dia.paraRevisar.length})</h3>
              <ul className="lista-pr">
                {dia.paraRevisar.map((p) => (
                  <li key={p.numero}>
                    <button className="enlace" onClick={() => abrirRevision(String(p.numero))}>
                      #{p.numero}
                    </button>{' '}
                    {p.titulo} · {p.autor} <Distintivo pr={p} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
