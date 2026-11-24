import { useEffect, useMemo, useRef, useState } from 'react';
import { buscarNodos, puntosClave } from '@hilo/core/analisis-grafo';
import { preguntarAlAgente } from '../lib/agente';
import { useGrafo } from '../lib/grafoDatos';

export interface Destino {
  id: string;
  nombre: string;
  corto: string;
}

const POR_VISTA: Record<string, string[]> = {
  inicio: ['¿Qué debo hacer primero hoy y por qué?', 'Explícame quién me bloquea y cómo destrabarlo'],
  grafo: ['¿Por dónde empiezo a leer este proyecto?'],
  notas: ['¿Qué documentos debería leer para mi tarea?'],
  revisar: ['¿Qué PR debería revisar primero y por qué?'],
  tablero: ['¿Cómo reparto la cola entre integradores?'],
  ajustes: ['¿Cómo reduzco el gasto de tokens sin perder calidad?'],
  agentes: ['¿Cuándo conviene usar el orquestador y cuándo el asistente?'],
  hilos: ['¿Qué debería anotar en el hilo de mi tarea?'],
  asistente: [],
};

/** Paleta de comandos: preguntarle algo al agente, ir a una sección o saltar a un nodo del grafo. */
export function Paleta({ vista, destinos, ir, irANodo, cerrar }: { vista: string; destinos: Destino[]; ir: (id: string) => void; irANodo: (id: string) => void; cerrar: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const caja = useRef<HTMLInputElement>(null);
  const g = useGrafo();
  useEffect(() => caja.current?.focus(), []);

  const items = useMemo(() => {
    const t = q.trim();
    const salida: { clave: string; titulo: string; sub: string; ir: () => void }[] = [];
    const preguntar = (texto: string) => () => {
      cerrar();
      if (texto === '¿Por dónde empiezo a leer este proyecto?') {
        const clave = puntosClave(g, 8).map((c) => `- ${c.nodo.label} (${c.nodo.archivo ?? ''}) · lo usan ${c.conexiones}`).join('\n');
        preguntarAlAgente({ mostrar: texto, texto: `${texto} Estos son los nodos de los que más cosas dependen:\n${clave}\nProponme un orden de lectura corto y qué entender de cada uno.` });
      } else preguntarAlAgente({ mostrar: texto, texto });
    };
    if (t) salida.push({ clave: 'libre', titulo: `Preguntar: ${t}`, sub: 'Al agente, con tus tareas y PR como contexto', ir: preguntar(t) });
    for (const s of POR_VISTA[vista] ?? []) if (!t || s.toLowerCase().includes(t.toLowerCase())) salida.push({ clave: s, titulo: s, sub: 'Sugerencia para esta pantalla', ir: preguntar(s) });
    const f = t.toLowerCase();
    for (const d of destinos) if (!f || d.nombre.toLowerCase().includes(f.replace(/^ir a /, ''))) salida.push({ clave: `ir-${d.id}`, titulo: `Ir a ${d.nombre}`, sub: d.corto, ir: () => { cerrar(); ir(d.id); } });
    if (t.length >= 2) for (const n of buscarNodos(g, t, 4)) salida.push({ clave: `n-${n.id}`, titulo: n.label, sub: `Nodo del grafo · ${n.nombreComunidad ?? ''}`, ir: () => { cerrar(); irANodo(n.id); } });
    return salida.slice(0, 9);
  }, [q, vista, destinos, g, ir, irANodo, cerrar]);

  useEffect(() => setSel(0), [q]);
  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cerrar();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((x) => Math.min(items.length - 1, x + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((x) => Math.max(0, x - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[sel]?.ir();
    }
  };
  return (
    <>
      <div className="ayuda-velo" onClick={cerrar} />
      <div className="paleta vidrio-fuerte" role="dialog" aria-label="Preguntar al agente">
        <input ref={caja} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={tecla} placeholder="Pregunta, ve a una sección o busca un nodo…" aria-label="Escribe tu pregunta" />
        <ul>
          {items.map((it, i) => (
            <li key={it.clave}>
              <button className={i === sel ? 'activo' : ''} onMouseEnter={() => setSel(i)} onClick={it.ir}>
                <b>{it.titulo}</b>
                <span>{it.sub}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="suave vacio-paleta">Escribe lo que necesitas. El agente conoce tu rol, tus tareas y el mapa del proyecto.</li>}
        </ul>
        <footer>
          <span>↑↓ elegir</span>
          <span>↵ abrir</span>
          <span>esc cerrar</span>
        </footer>
      </div>
    </>
  );
}
