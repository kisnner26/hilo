import { useEffect, useState } from 'react';
import { api, type PaqueteVista } from '../lib/api';
import { preguntarAlAgente } from '../lib/agente';
import { verGrafo } from '../lib/grafoDatos';

/** Los nodos que fijaste, juntos en un solo paquete de contexto, con lo que ahorras frente a mandar todo. */
export function PaqueteFijado({ ids, quitar, vaciar }: { ids: string[]; quitar: (id: string) => void; vaciar: () => void }) {
  const [p, setP] = useState<PaqueteVista | null>(null);
  const [copiado, setCopiado] = useState(false);
  const clave = ids.join('|');
  useEffect(() => {
    setCopiado(false);
    if (ids.length === 0) return setP(null);
    let vivo = true;
    const t = setTimeout(() => void api.contexto({ alcance: { tipo: 'nodos', ids, saltos: 1 }, conciso: true, sinRuido: true, presupuesto: 2000 }).then((x) => vivo && setP(x)), 150);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  if (ids.length === 0) return null;
  const nombre = (id: string) => verGrafo().nodos.find((n) => n.id === id)?.label ?? id;
  return (
    <section className="paquete-fijado vidrio">
      <header>
        <b>Paquete a la medida</b>
        <button className="enlace" onClick={vaciar}>
          Vaciar
        </button>
      </header>
      <div className="chips-fijados">
        {ids.map((id) => (
          <button key={id} className="chip-fijado" onClick={() => quitar(id)} title="Quitar">
            {nombre(id)} <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      {p && (
        <>
          <div className="comparacion">
            <div>
              <strong>~{p.tokens.toLocaleString('es')}</strong>
              <span>tokens tuyos</span>
            </div>
            <div>
              <strong className="tachado">~{p.tokensTodo.toLocaleString('es')}</strong>
              <span>todo el proyecto</span>
            </div>
            <div className="bueno">
              <strong>−{Math.round(p.ahorro * 100)} %</strong>
              <span>menos entrada</span>
            </div>
          </div>
          <div className="fila">
            <button
              className="boton secundario"
              onClick={async () => {
                await api.copiar(p.texto);
                setCopiado(true);
              }}
            >
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
            <button className="boton" onClick={() => preguntarAlAgente({ mostrar: `Pregunta con ${ids.length} nodo${ids.length === 1 ? '' : 's'} fijado${ids.length === 1 ? '' : 's'}`, texto: `Con este contexto del proyecto, ayúdame a entender cómo se relacionan estas piezas y por dónde empezar a trabajar en ellas. Si falta algo, dime qué archivo abrir.\n\n${p.texto}` })}>
              Preguntar al agente
            </button>
          </div>
        </>
      )}
    </section>
  );
}
