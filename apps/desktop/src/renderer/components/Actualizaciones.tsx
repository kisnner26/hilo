import { useEffect, useState } from 'react';
import { api, type ActualizacionVista, type EventoActualizar, type VersionVista } from '../lib/api';
import { mdAHtml } from '../lib/markdown';

const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
const limpio = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** Versión instalada, búsqueda de versiones nuevas y actualización con un botón, sin ir a GitHub. */
export function Actualizaciones() {
  const [v, setV] = useState<VersionVista | null>(null);
  const [u, setU] = useState<ActualizacionVista | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const [ev, setEv] = useState<EventoActualizar | null>(null);
  const [reviso, setReviso] = useState(false);
  const [hora, setHora] = useState('');
  const [destello, setDestello] = useState(0);

  const comprobar = async () => {
    setBuscando(true);
    setError('');
    const t0 = Date.now();
    try {
      const r = await api.comprobarActualizacion();
      // Aunque GitHub conteste al instante, se deja ver «Buscando…» un momento: así se nota que hizo algo.
      await new Promise((ok) => setTimeout(ok, Math.max(0, 900 - (Date.now() - t0))));
      setU(r);
      setReviso(true);
    } catch (e) {
      setError(limpio(e));
    } finally {
      setHora(new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDestello((x) => x + 1);
      setBuscando(false);
    }
  };

  useEffect(() => {
    void api.versionApp().then((x) => {
      setV(x);
      if (x.ultima) setU(x.ultima);
    });
    void comprobar();
    return api.alActualizar(setEv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const instalar = async () => {
    setError('');
    setEv({ tipo: 'descargando', bajados: 0, total: u?.asset?.tam ?? 0 });
    try {
      await api.instalarActualizacion();
    } catch (e) {
      setError(limpio(e));
      setEv(null);
    }
  };

  const ocupado = ev !== null && ev.tipo !== 'error' && ev.tipo !== 'disponible';
  const pct = ev?.tipo === 'descargando' && ev.total ? Math.min(100, Math.round(((ev.bajados ?? 0) / ev.total) * 100)) : 0;

  return (
    <div className="pestana">
      <section className="conexion destacada actualizacion">
        <div className="fila-interruptor">
          <div>
            <b>Hilo {v?.version ?? '…'}</b>
            <span className="suave">Versión instalada</span>
          </div>
          <button className="boton secundario" onClick={() => void comprobar()} disabled={buscando || ocupado}>
            {buscando ? 'Buscando…' : 'Comprobar actualizaciones'}
          </button>
        </div>

        <div key={destello} className={`resultado-act ${buscando ? 'buscando' : error ? 'mal' : u?.hay ? 'nueva' : reviso ? 'ok' : ''}`} role="status" aria-live="polite">
          <span className="icono-act" aria-hidden="true">
            {buscando ? <i className="giro" /> : error ? '!' : u?.hay ? '↑' : reviso ? '✓' : ''}
          </span>
          <div>
            <b>
              {buscando
                ? 'Buscando versiones nuevas en GitHub…'
                : error
                  ? 'No pude comprobar las actualizaciones'
                  : u?.hay
                    ? `Hay una versión nueva: ${u.ultima}`
                    : reviso
                      ? `Estás al día: la ${v?.version ?? u?.actual ?? ''} es la más nueva`
                      : 'Todavía no se ha comprobado'}
            </b>
            {!buscando && hora && <span className="suave">{error ? error : `Comprobado a las ${hora}`}</span>}
          </div>
        </div>

        {u?.hay && (
          <div className="nueva-version">
            <div className="fila-version">
              <div>
                <strong>Versión {u.ultima}</strong>
                <span className="suave">
                  {u.asset ? `${u.asset.nombre} · ${mb(u.asset.tam)}` : 'No hay un archivo para tu sistema'} · publicada el {u.publicada.slice(0, 10)}
                </span>
              </div>
              {ocupado ? (
                <button className="boton" disabled>
                  {ev?.tipo === 'descargando' ? `Descargando ${pct} %` : ev?.tipo === 'instalando' ? 'Instalando…' : 'Reiniciando…'}
                </button>
              ) : (
                <button className="boton" onClick={() => void instalar()}>
                  {u.asset ? 'Actualizar ahora' : 'Ver en GitHub'}
                </button>
              )}
            </div>
            {ev?.tipo === 'descargando' && (
              <div className="barra-medidor">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
            {u.notas && <div className="md notas-version" dangerouslySetInnerHTML={{ __html: mdAHtml(u.notas) }} />}
            <p className="suave nota-uso">
              Hilo se cierra, se reemplaza por la versión nueva y vuelve a abrirse solo. Tus cuentas, ajustes y notas se conservan. {v && !v.empaquetada ? 'Esta es una copia de desarrollo: solo la app instalada se actualiza sola.' : ''}
            </p>
          </div>
        )}
      </section>

      <section className="conexion">
        <div className="fila-interruptor">
          <div>
            <b>Avisarme cuando haya una versión nueva</b>
            <span className="suave">Revisa cada pocas horas y manda una notificación. Nunca descarga ni instala sin que lo pidas.</span>
          </div>
          <button
            className={`interruptor${v?.auto !== false ? ' si' : ''}`}
            role="switch"
            aria-checked={v?.auto !== false}
            onClick={() => {
              const n = !(v?.auto !== false);
              setV((x) => (x ? { ...x, auto: n } : x));
              void api.actualizacionesAuto(n);
            }}
          >
            {v?.auto !== false ? 'Sí' : 'No'}
          </button>
        </div>
        <div className="fila-interruptor">
          <div>
            <b>Ver todas las versiones</b>
            <span className="suave">Las notas de cada versión están en GitHub.</span>
          </div>
          <button className="boton secundario" onClick={() => void api.paginaActualizacion()}>
            Abrir en GitHub
          </button>
        </div>
      </section>
    </div>
  );
}
