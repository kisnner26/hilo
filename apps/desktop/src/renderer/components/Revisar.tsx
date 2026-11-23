import { useEffect, useMemo, useState } from 'react';
import { api, type Informe, type RevisionVista } from '../lib/api';

type Filtro = 'todos' | 'errores' | 'listos';

function Hallazgos({ items }: { items: RevisionVista['hallazgos'] }) {
  return (
    <ul className="hallazgos-chicos">
      {items.map((h, i) => (
        <li key={i} className={h.gravedad === 'ERROR' ? 'hall-error' : 'hall-aviso'}>
          <b>{h.regla}</b>
          <span>{h.mensaje}</span>
          {h.arreglo && <em>{h.arreglo}</em>}
        </li>
      ))}
    </ul>
  );
}

/** Integradores: todos los PR listos se revisan solos y se ordenan por lo que más necesita atención. */
function RevisionAutomatica() {
  const [lista, setLista] = useState<RevisionVista[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [abierto, setAbierto] = useState<number | null>(null);
  const [msg, setMsg] = useState<Record<number, string>>({});

  const cargar = async () => {
    setCargando(true);
    setError('');
    try {
      setLista(await api.revisarCola());
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setCargando(false);
    }
  };
  useEffect(() => void cargar(), []);

  const conErrores = lista?.filter((r) => r.errores > 0).length ?? 0;
  const visibles = useMemo(() => (lista ?? []).filter((r) => (filtro === 'todos' ? true : filtro === 'errores' ? r.errores > 0 : r.errores === 0)), [lista, filtro]);

  const publicar = async (r: RevisionVista) => {
    try {
      const res = await api.publicarGithub(String(r.numero), r.comentario);
      setMsg((m) => ({ ...m, [r.numero]: res.publicado ? 'Publicado' : 'Cancelado' }));
    } catch (e) {
      setMsg((m) => ({ ...m, [r.numero]: String(e instanceof Error ? e.message : e) }));
    }
  };

  return (
    <>
      <div className="barra-lista">
        <div className="segmentos-v">
          {(
            [
              ['todos', `Todos ${lista?.length ?? 0}`],
              ['errores', `Con errores ${conErrores}`],
              ['listos', `Sin errores ${(lista?.length ?? 0) - conErrores}`],
            ] as [Filtro, string][]
          ).map(([k, t]) => (
            <button key={k} className={filtro === k ? 'activo' : ''} onClick={() => setFiltro(k)}>
              {t}
            </button>
          ))}
        </div>
        <button className="boton secundario" disabled={cargando} onClick={() => void cargar()}>
          {cargando ? 'Revisando…' : 'Volver a revisar'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {cargando && !lista && (
        <div className="esqueletos">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="esqueleto" />
          ))}
        </div>
      )}
      <ul className="filas-pr">
        {visibles.map((r) => (
          <li key={r.numero} className={`fila-pr${abierto === r.numero ? ' abierta' : ''}`}>
            <button className="fila-pr-cabeza" onClick={() => setAbierto(abierto === r.numero ? null : r.numero)}>
              <span className={`punto ${r.errores > 0 ? 'mal' : r.avisos > 0 ? 'pend' : 'ok'}`}>{r.errores > 0 ? r.errores : r.avisos > 0 ? r.avisos : '✓'}</span>
              <span className="titulo-pr">
                <b>#{r.numero}</b> {r.titulo}
              </span>
              <span className="etiquetas-pr">
                <span className="dist">{r.autor}</span>
                <span className={`dist ${r.lineas > 400 ? 'pend' : ''}`}>{r.lineas} líneas</span>
                <span className={`dist ${r.ci === 'ok' ? 'ok' : r.ci === 'fallo' ? 'mal' : 'pend'}`}>CI {r.ci}</span>
              </span>
            </button>
            {abierto === r.numero && (
              <div className="detalle-pr">
                {r.hallazgos.length === 0 ? <p className="bien">El formato está completo.</p> : <Hallazgos items={r.hallazgos} />}
                <div className="fila">
                  <button className="boton secundario" onClick={() => void api.copiar(r.comentario)}>
                    Copiar comentario
                  </button>
                  {r.errores + r.avisos > 0 && (
                    <button className="boton" onClick={() => void publicar(r)}>
                      Publicar en el PR
                    </button>
                  )}
                  {msg[r.numero] && <span className="suave">{msg[r.numero]}</span>}
                </div>
              </div>
            )}
          </li>
        ))}
        {lista && visibles.length === 0 && <p className="vacio-chico">Nada en esta vista.</p>}
      </ul>
    </>
  );
}

/** Los demás roles corrigen su propio PR: el número, y una lista corta de qué arreglar. */
function CorregirMiPr({ inicial, volver }: { inicial: string; volver?: () => void }) {
  const [numero, setNumero] = useState(inicial);
  const [informe, setInforme] = useState<Informe | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const revisar = async (n: string) => {
    setCargando(true);
    setError('');
    try {
      setInforme(await api.revisarPr(n.replace('#', '')));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setInforme(null);
    } finally {
      setCargando(false);
    }
  };
  useEffect(() => {
    if (inicial) void revisar(inicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial]);
  const items = informe ? [...informe.errores.map((h) => ({ ...h, gravedad: 'ERROR' as const })), ...informe.avisos.map((h) => ({ ...h, gravedad: 'AVISO' as const }))] : [];
  return (
    <>
      {volver && (
        <button className="enlace" onClick={volver}>
          ← Mi día
        </button>
      )}
      <div className="fila">
        <input className="campo" placeholder="Número de tu PR" value={numero} onChange={(e) => setNumero(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && numero && void revisar(numero)} />
        <button className="boton" disabled={!numero || cargando} onClick={() => void revisar(numero)}>
          {cargando ? 'Revisando…' : 'Revisar'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {informe && (informe.ok && items.length === 0 ? <p className="bien">Listo: el formato está completo.</p> : <Hallazgos items={items} />)}
    </>
  );
}

export function Revisar({ integrador, inicial, volver }: { integrador: boolean; inicial: string; volver: () => void }) {
  return (
    <div className="columna ancha">
      <h2>{integrador ? 'Revisar PR' : 'Corregir tu PR'}</h2>
      {integrador ? <RevisionAutomatica /> : <CorregirMiPr inicial={inicial} volver={volver} />}
    </div>
  );
}
