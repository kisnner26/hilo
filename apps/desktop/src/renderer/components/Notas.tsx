import { useEffect, useMemo, useState } from 'react';
import { api, type NotaVista } from '../lib/api';
import { mdAHtml } from '../lib/markdown';
import type { NodoVista } from '../lib/galaxy';
import { extractoRelevante } from '../lib/extracto';
import { PreguntarAgente } from './PreguntarAgente';

const minutos = (palabras: number) => Math.max(1, Math.round(palabras / 200));

/** Notas en tres bloques: carpetas, lista con vista previa y lector. */
export function Notas({ nodo }: { nodo: NodoVista | null }) {
  const [notas, setNotas] = useState<NotaVista[]>([]);
  const [carpeta, setCarpeta] = useState('todas');
  const [filtro, setFiltro] = useState('');
  const [abierta, setAbierta] = useState('');
  const [texto, setTexto] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => void api.notas().then(setNotas), []);
  useEffect(() => {
    if (nodo?.archivo && notas.some((n) => n.ruta === nodo.archivo)) setAbierta(nodo.archivo);
  }, [nodo, notas]);
  useEffect(() => {
    setCopiado(false);
    if (abierta) void api.nota(abierta).then((t) => setTexto(t ?? 'No se pudo leer la nota.'));
  }, [abierta]);

  const carpetas = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notas) m.set(n.carpeta, (m.get(n.carpeta) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [notas]);
  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return notas.filter((n) => (carpeta === 'todas' || n.carpeta === carpeta) && (!f || `${n.titulo} ${n.resumen}`.toLowerCase().includes(f)));
  }, [notas, carpeta, filtro]);
  const actual = notas.find((n) => n.ruta === abierta);

  return (
    <div className="notas">
      <aside className="notas-lista vidrio">
        <div className="buscador">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input placeholder="Buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        <div className="chips-carpeta">
          <button className={`chip-c${carpeta === 'todas' ? ' activo' : ''}`} onClick={() => setCarpeta('todas')}>
            Todas <em>{notas.length}</em>
          </button>
          {carpetas.map(([c, n]) => (
            <button key={c} className={`chip-c${carpeta === c ? ' activo' : ''}`} onClick={() => setCarpeta(c)}>
              {c} <em>{n}</em>
            </button>
          ))}
        </div>
        <div className="tarjetas-nota">
          {visibles.length === 0 && <p className="vacio-chico">{notas.length === 0 ? 'Conecta una carpeta de Markdown en Ajustes.' : 'Sin resultados.'}</p>}
          {visibles.map((n) => (
            <button key={n.ruta} className={`tarjeta-nota${abierta === n.ruta ? ' activa' : ''}`} onClick={() => setAbierta(n.ruta)}>
              <strong>{n.titulo}</strong>
              <span className="extracto">{n.resumen}</span>
              <span className="meta">
                {n.carpeta} · {minutos(n.palabras)} min
              </span>
            </button>
          ))}
        </div>
      </aside>

      <article className="lector vidrio">
        {actual ? (
          <>
            <header>
              <div>
                <span className="migas">{actual.carpeta}</span>
                <h1>{actual.titulo}</h1>
                <span className="meta">
                  {minutos(actual.palabras)} min de lectura · {actual.palabras.toLocaleString('es')} palabras
                </span>
              </div>
              <div className="botones-accion">
                <PreguntarAgente etiqueta="Resumir" pedido={{ mostrar: `Resume «${actual.titulo}»`, texto: `Resume esta nota en 5 líneas y dime qué decisiones o pendientes contiene. Usa solo su texto.\n\n# ${actual.titulo}\n${extractoRelevante(texto, 'decisión pendiente objetivo alcance conclusión', 2400)}` }} />
                <PreguntarAgente etiqueta="¿Qué me toca?" pedido={{ mostrar: `¿Qué de «${actual.titulo}» me toca a mí?`, texto: `Según esta nota, ¿qué me corresponde hacer a mí según mi rol y mis tareas? Si no consta, dilo.\n\n# ${actual.titulo}\n${extractoRelevante(texto, 'responsable tarea entrega rol pendiente', 2000)}` }} />
                <button
                  className="boton secundario"
                  onClick={async () => {
                    await api.copiar(texto);
                    setCopiado(true);
                  }}
                >
                  {copiado ? 'Copiada' : 'Copiar'}
                </button>
              </div>
            </header>
            <div className="cuerpo-nota" dangerouslySetInnerHTML={{ __html: mdAHtml(texto) }} />
          </>
        ) : (
          <div className="estado-vacio">
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h9l4 4v14H6z" />
              <path d="M14 3v5h5M9 13h7M9 17h5" />
            </svg>
            <p>Elige una nota</p>
          </div>
        )}
      </article>
    </div>
  );
}
