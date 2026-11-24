import { useMemo, useState, type ReactNode } from 'react';
import type { Conexion } from '../lib/api';
import { preguntarAlAgente } from '../lib/agente';

export interface SeccionAyuda {
  id: string;
  nombre: string;
  corto: string;
  icono: ReactNode;
}

const hecho = (k: string) => {
  try {
    return Boolean(localStorage.getItem(k));
  } catch {
    return false;
  }
};

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const CMD = MAC ? '⌘' : 'Ctrl';

const ATAJOS: [string, string][] = [
  [`${CMD} K`, 'Preguntarle al agente desde cualquier pantalla'],
  [`${CMD} ⇧ M`, 'Dictar con la voz: empieza o termina de escuchar'],
  [`${CMD} B`, 'Ocultar o mostrar la navegación'],
  ['F', 'En el grafo, enfocar lo elegido'],
  ['Esc', 'Cerrar paneles y menús'],
];

/** Palabras del proyecto explicadas sin jerga. */
const GLOSARIO: [string, string][] = [
  ['Grafo', 'Un mapa del proyecto. Cada punto es un archivo, nota o concepto; las líneas dicen quién usa a quién. Sirve para pasarle al agente solo lo que importa, no todo.'],
  ['Hilo', 'La memoria de una tarea: qué objetivo tiene, qué ya se decidió y qué falta. Se le recuerda al agente en cada turno para que no pierda el rumbo.'],
  ['Piloto automático', 'Un botón que prepara tus pendientes en lote: lo que Hilo resuelve solo, lo que redacta un agente y lo que un agente hace en una copia aparte. Nada sale sin que lo apruebes.'],
  ['Bandeja', 'Donde el piloto deja lo que preparó. Lo revisas y apruebas; solo entonces se publica.'],
  ['Espacio aislado', 'Una copia del proyecto en su propia rama donde el agente edita y prueba, sin tocar lo que tienes abierto.'],
  ['Ahorro de tokens', 'Un token es un trocito de texto que el agente lee o escribe, y gastarlos cuesta cuota de tu suscripción. Hilo manda solo lo necesario y te muestra cuánto evitó.'],
  ['Contexto', 'Lo que el agente sabe en cada pregunta. Más contexto no siempre es mejor: cuesta más y a veces confunde.'],
  ['Paquete a la medida', 'Nodos del grafo que tú fijas para armar un contexto justo, y copiarlo a tu propia terminal.'],
  ['Dictado', 'Habla en vez de escribir: el texto aparece mientras hablas y, si lo dejas, se envía solo cuando haces una pausa larga. En Mac usa el reconocimiento de voz del sistema.'],
  ['Rol', 'Documentador, desarrollador, tester o integrador. Decide qué ves y qué acciones te sugiere Hilo.'],
];

const PREGUNTAS: [string, string][] = [
  ['No veo mis tareas', 'Conecta ClickUp y revisa que sigues la lista de tu sprint, en Ajustes › Cuentas.'],
  ['¿Qué gasta tokens?', 'Solo las preguntas libres y los pasos con agente. Lo demás (tus tareas, quién te frena, entregas y avisos) se resuelve sin modelo. Mira el detalle en Ajustes › Ahorro.'],
  ['¿Es seguro?', 'Tus tokens se guardan cifrados con el llavero del sistema. Nada se publica sin que lo confirmes, y los agentes que editan trabajan en una copia aparte, sin poder hacer push ni borrar.'],
  ['¿Dónde está Revisar PR?', 'Solo aparece para integradores.'],
  ['¿Para qué sirve el grafo?', 'Elige un punto y verás qué usa, qué lo usa y qué se rompe si lo cambias. Desde ahí puedes preguntarle al agente con el contexto justo.'],
  ['¿Cómo hago que cueste menos?', 'Activa el ahorro en Ajustes › Ahorro, usa «Hacer mis pendientes» en vez de preguntar paso a paso y fija en el grafo solo los nodos que necesitas.'],
];

const coincide = (t: string, q: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q);
const limpio = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Ayuda lateral: busca, explica las palabras del proyecto y deja preguntarle al asistente cualquier duda. */
export function Ayuda({ cerrar, secciones, con, ir, verRecorrido, probarConexiones }: { cerrar: () => void; secciones: SeccionAyuda[]; con: Conexion | null; ir: (id: string) => void; verRecorrido: () => void; probarConexiones: () => void }) {
  const [q, setQ] = useState('');
  const pasos = [
    { texto: 'Conectar GitHub', ok: Boolean(con?.github.conectado), accion: probarConexiones },
    { texto: 'Conectar ClickUp', ok: Boolean(con?.clickup.conectado), accion: probarConexiones },
    { texto: 'Ver el recorrido', ok: hecho('hilo.recorrido'), accion: verRecorrido },
    { texto: 'Preguntarle algo al asistente', ok: hecho('hilo.pregunto'), accion: () => ir('asistente') },
  ];
  const hechos = pasos.filter((p) => p.ok).length;
  const f = limpio(q);
  const buscando = f.length >= 2;
  const glosario = useMemo(() => GLOSARIO.filter(([t, d]) => !buscando || coincide(`${t} ${d}`, f)), [buscando, f]);
  const preguntas = useMemo(() => PREGUNTAS.filter(([t, d]) => !buscando || coincide(`${t} ${d}`, f)), [buscando, f]);
  const vistas = useMemo(() => secciones.filter((s) => !buscando || coincide(`${s.nombre} ${s.corto}`, f)), [secciones, buscando, f]);
  const sinNada = buscando && glosario.length + preguntas.length + vistas.length === 0;

  const preguntar = () => {
    const t = q.trim();
    if (!t) return;
    cerrar();
    preguntarAlAgente({ mostrar: t, texto: `Soy nuevo en Hilo y tengo esta duda sobre cómo usarlo: ${t}\nResponde en pocas líneas y con lenguaje simple, y dime en qué pantalla hacerlo.` });
  };

  return (
    <>
      <div className="ayuda-velo" onClick={cerrar} />
      <aside className="ayuda vidrio-fuerte" role="dialog" aria-label="Ayuda">
        <header>
          <h2>Ayuda</h2>
          <button className="cerrar" onClick={cerrar} aria-label="Cerrar">
            ×
          </button>
        </header>

        <form
          className="buscar-ayuda"
          onSubmit={(e) => {
            e.preventDefault();
            preguntar();
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca una palabra o escribe tu duda…" aria-label="Buscar en la ayuda" />
          <button className="boton" type="submit" disabled={!q.trim()} title="Se lo pregunta al asistente">
            Preguntar
          </button>
        </form>

        {!buscando && (
          <section>
            <div className="progreso-ayuda">
              <span>Primeros pasos</span>
              <strong>
                {hechos} de {pasos.length}
              </strong>
            </div>
            <div className="barra-medidor">
              <i style={{ width: `${(hechos / pasos.length) * 100}%` }} />
            </div>
            <ul className="lista-pasos">
              {pasos.map((p) => (
                <li key={p.texto} className={p.ok ? 'hecho' : ''}>
                  <span className="marca">{p.ok ? '✓' : ''}</span>
                  <button onClick={p.accion} disabled={p.ok && p.texto.startsWith('Conectar')}>
                    {p.texto}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {vistas.length > 0 && (
          <section>
            <h3>Qué hace cada sección</h3>
            <div className="mini-secciones">
              {vistas.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    ir(s.id);
                    cerrar();
                  }}
                >
                  <span className="ic">{s.icono}</span>
                  <b>{s.nombre}</b>
                  <span>{s.corto}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {glosario.length > 0 && (
          <section>
            <h3>Las palabras de Hilo</h3>
            <dl className="glosario">
              {glosario.map(([t, d]) => (
                <div key={t}>
                  <dt>{t}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {!buscando && (
          <section>
            <h3>Atajos</h3>
            <ul className="atajos">
              {ATAJOS.map(([k, d]) => (
                <li key={k}>
                  <kbd>{k}</kbd>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {preguntas.length > 0 && (
          <section>
            <h3>Preguntas rápidas</h3>
            {preguntas.map(([p, r]) => (
              <details key={p} className="pregunta">
                <summary>{p}</summary>
                <p>{r}</p>
              </details>
            ))}
          </section>
        )}

        {sinNada && (
          <section className="sin-resultados">
            <p className="suave">No encontré «{q.trim()}» en la ayuda.</p>
            <button className="boton" onClick={preguntar}>
              Preguntárselo al asistente
            </button>
          </section>
        )}

        <div className="acciones-ayuda">
          <button className="boton" onClick={() => { cerrar(); verRecorrido(); }}>
            Ver el recorrido
          </button>
          <button className="boton secundario" onClick={() => { cerrar(); probarConexiones(); }}>
            Probar conexiones
          </button>
        </div>
      </aside>
    </>
  );
}
