import { useEffect, useMemo, useState } from 'react';
import { buscarNodos, conexiones, dependencias, describir, impacto, rutaMasCorta, type NodoG } from '@hilo/core/analisis-grafo';
import { api, type PaqueteVista } from '../lib/api';
import { preguntarAlAgente } from '../lib/agente';
import { useGrafo } from '../lib/grafoDatos';
import type { NodoVista } from '../lib/galaxy';

const lista = (xs: { nodo: NodoG; extra?: string }[], max = 25) => xs.slice(0, max).map((x) => `- ${x.nodo.label}${x.nodo.archivo ? ` (${x.nodo.archivo})` : ''}${x.extra ? ` ${x.extra}` : ''}`).join('\n');

function Fila({ n, extra, alElegir }: { n: NodoG; extra?: string; alElegir: (id: string) => void }) {
  return (
    <li>
      <button className="enlace-nodo" onClick={() => alElegir(n.id)} title={n.archivo ?? n.label}>
        {n.label}
      </button>
      {extra && <span className="dist">{extra}</span>}
    </li>
  );
}

function Seccion({ titulo, cuenta, ayuda, abierta, children }: { titulo: string; cuenta: number; ayuda: string; abierta?: boolean; children: React.ReactNode }) {
  return (
    <details className="seccion-nodo" open={abierta}>
      <summary>
        <span>{titulo}</span>
        <em>{cuenta}</em>
      </summary>
      <p className="suave">{ayuda}</p>
      {children}
    </details>
  );
}

/** Todo lo que se puede saber de un nodo sin gastar tokens, y atajos para preguntarle al agente con el contexto justo. */
export function InspectorNodo({ nodo, cerrar, alElegir, fijado, alFijar, abrirNota }: { nodo: NodoVista; cerrar: () => void; alElegir: (id: string) => void; fijado: boolean; alFijar: () => void; abrirNota: () => void }) {
  const g = useGrafo();
  const [paquete, setPaquete] = useState<PaqueteVista | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [destino, setDestino] = useState('');
  const [ruta, setRuta] = useState<ReturnType<typeof rutaMasCorta>>(undefined);
  const [sinRuta, setSinRuta] = useState(false);

  const c = useMemo(() => conexiones(g, nodo.id), [g, nodo.id]);
  const afecta = useMemo(() => impacto(g, nodo.id, 3), [g, nodo.id]);
  const necesita = useMemo(() => dependencias(g, nodo.id, 2), [g, nodo.id]);
  const frase = useMemo(() => describir(g, nodo.id), [g, nodo.id]);
  const archivos = new Set(afecta.map((x) => x.nodo.archivo).filter(Boolean)).size;
  const candidatos = useMemo(() => (destino.trim().length >= 2 ? buscarNodos(g, destino, 5).filter((x) => x.id !== nodo.id) : []), [g, destino, nodo.id]);

  useEffect(() => {
    setPaquete(null);
    setCopiado(false);
    setDestino('');
    setRuta(undefined);
    setSinRuta(false);
    void api.contexto({ alcance: { tipo: 'vecindad', nodo: nodo.id, saltos: 1 }, conciso: true, sinRuido: true, presupuesto: 1200 }).then(setPaquete);
  }, [nodo.id]);

  const ctx = paquete?.texto ?? '';
  const esNota = Boolean(nodo.archivo && /\.md$/i.test(nodo.archivo));
  const pedir = (mostrar: string, texto: string) => preguntarAlAgente({ mostrar, texto });
  const acciones: { titulo: string; sub: string; ir: () => void }[] = [
    { titulo: 'Explícamelo', sub: 'Qué es y para qué sirve', ir: () => pedir(`Explícame «${nodo.label}»`, `Explícame qué es "${nodo.label}" y para qué sirve en el proyecto. Usa solo este contexto del grafo; si algo no consta, dilo.\n\n${frase}\n\n${ctx}`) },
    { titulo: '¿Qué se rompe si lo cambio?', sub: `${afecta.length} nodo${afecta.length === 1 ? '' : 's'} dependen de él`, ir: () => pedir(`¿Qué se rompe si cambio «${nodo.label}»?`, `¿Qué podría romperse si cambio "${nodo.label}"? Estos nodos dependen de él, con su distancia en saltos:\n${lista(afecta.map((x) => ({ nodo: x.nodo, extra: `· ${x.distancia} salto${x.distancia === 1 ? '' : 's'}` })))}\n\nDime qué pruebas correr y qué revisar primero. Usa solo esta lista.`) },
    { titulo: 'Propón pruebas', sub: 'Casos para cubrirlo', ir: () => pedir(`Propón pruebas para «${nodo.label}»`, `Propón los casos de prueba que faltan para "${nodo.label}", con datos de ejemplo y sin datos reales. Esto es lo que usa:\n${lista(necesita.map((x) => ({ nodo: x.nodo })), 15)}\n\nY esto lo usa a él:\n${lista(c.entra.map((x) => ({ nodo: x.nodo })), 10)}`) },
    { titulo: '¿Cómo se usa?', sub: 'Ejemplos desde quien lo usa', ir: () => pedir(`¿Cómo se usa «${nodo.label}»?`, `¿Cómo se usa "${nodo.label}" desde el resto del proyecto? Estos ya lo usan:\n${lista(c.entra.map((x) => ({ nodo: x.nodo, extra: `· ${x.relacion}` })), 15)}\n\nSi hace falta ver código, dime qué archivo abrir primero en lugar de leer todo.`) },
  ];

  const buscarRuta = (id: string) => {
    const r = rutaMasCorta(g, nodo.id, id);
    setRuta(r);
    setSinRuta(!r);
    setDestino('');
  };

  return (
    <aside className="inspector inspector-nodo">
      <header>
        <div>
          <strong>{nodo.label}</strong>
          <span className="chips-linea">
            {nodo.tipo && <span className="dist">{nodo.tipo}</span>}
            <span className="dist">{nodo.nombreComunidad}</span>
          </span>
        </div>
        <button className="cerrar" onClick={cerrar} aria-label="Cerrar">
          ×
        </button>
      </header>
      {nodo.archivo && <p className="mono ruta-nodo">{nodo.archivo}</p>}
      <p className="frase-nodo">{frase}</p>

      <div className="preguntar-nodo">
        <h4>Preguntarle al agente</h4>
        <div className="rejilla-acciones">
          {acciones.map((a) => (
            <button key={a.titulo} className="accion-nodo" onClick={a.ir}>
              <b>{a.titulo}</b>
              <span>{a.sub}</span>
            </button>
          ))}
        </div>
        {paquete && (
          <p className="ahorro-nodo">
            Le mando <b>~{paquete.tokens.toLocaleString('es')} tokens</b> de contexto en vez de ~{paquete.tokensTodo.toLocaleString('es')} del proyecto entero: <b>{Math.round(paquete.ahorro * 100)} % menos</b>.
          </p>
        )}
      </div>

      <Seccion titulo="Usa" cuenta={c.sale.length} ayuda="Lo que este nodo necesita para funcionar. Haz clic para ir a él." abierta>
        <ul className="lista-nodos">{c.sale.slice(0, 12).map((x) => <Fila key={x.nodo.id} n={x.nodo} extra={x.relacion} alElegir={alElegir} />)}{c.sale.length === 0 && <li className="suave">No usa nada del proyecto.</li>}</ul>
      </Seccion>
      <Seccion titulo="Lo usan" cuenta={c.entra.length} ayuda="Quién depende de este nodo directamente." abierta>
        <ul className="lista-nodos">{c.entra.slice(0, 12).map((x) => <Fila key={x.nodo.id} n={x.nodo} extra={x.relacion} alElegir={alElegir} />)}{c.entra.length === 0 && <li className="suave">Nada lo usa directamente.</li>}</ul>
      </Seccion>
      <Seccion titulo="Si lo cambias" cuenta={afecta.length} ayuda={`Lo que podría verse afectado, hasta 3 saltos: ${afecta.length} nodos en ${archivos} archivo${archivos === 1 ? '' : 's'}.`}>
        <ul className="lista-nodos">{afecta.slice(0, 15).map((x) => <Fila key={x.nodo.id} n={x.nodo} extra={`${x.distancia}`} alElegir={alElegir} />)}</ul>
      </Seccion>
      <Seccion titulo="Cómo se conecta con…" cuenta={ruta ? ruta.length - 1 : 0} ayuda="Busca otro nodo y te muestro el camino más corto entre los dos.">
        <input className="campo" placeholder="Buscar otro nodo" value={destino} onChange={(e) => setDestino(e.target.value)} />
        {candidatos.length > 0 && (
          <ul className="lista-nodos">{candidatos.map((x) => <li key={x.id}><button className="enlace-nodo" onClick={() => buscarRuta(x.id)}>{x.label}</button></li>)}</ul>
        )}
        {sinRuta && <p className="suave">No hay camino entre esos dos nodos.</p>}
        {ruta && (
          <ol className="ruta-pasos">
            {ruta.map((p, i) => (
              <li key={p.nodo.id}>
                {i > 0 && <em>{p.relacion}</em>}
                <button className="enlace-nodo" onClick={() => alElegir(p.nodo.id)}>{p.nodo.label}</button>
              </li>
            ))}
          </ol>
        )}
      </Seccion>

      <div className="pie-nodo">
        <button className={`boton${fijado ? ' secundario' : ''}`} onClick={alFijar}>
          {fijado ? 'Quitar del paquete' : 'Fijar en el paquete'}
        </button>
        <button
          className="boton secundario"
          disabled={!paquete}
          onClick={async () => {
            await api.copiar(ctx);
            setCopiado(true);
          }}
        >
          {copiado ? 'Copiado' : 'Copiar contexto'}
        </button>
        {esNota && (
          <button className="boton secundario" onClick={abrirNota}>
            Abrir la nota
          </button>
        )}
      </div>
      <p className="suave nota-pie">Fija varios nodos y arma un paquete a la medida para pegar en tu propia terminal: solo lo que importa.</p>
    </aside>
  );
}
