import type { ReactNode } from 'react';
import type { Conexion } from '../lib/api';

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

const PREGUNTAS: [string, string][] = [
  ['No veo mis tareas', 'Conecta ClickUp y revisa que sigues la lista de tu sprint, en Ajustes › Cuentas.'],
  ['¿Qué gasta tokens?', 'Solo las preguntas libres y los agentes. Lo demás se responde sin modelo. Ajústalo en Ajustes › Ahorro.'],
  ['¿Qué hace el piloto automático?', 'Prepara tus pendientes en lote y los deja en una bandeja. Lo que sale a otras personas (comentarios, ramas, PR) solo se publica cuando lo apruebas.'],
  ['¿Es seguro?', 'Tus tokens se guardan cifrados con el llavero del sistema y nada se publica sin que lo confirmes.'],
  ['¿Dónde está Revisar PR?', 'Solo aparece para integradores.'],
];

/** Panel de ayuda lateral: qué falta por hacer, qué hace cada sección y respuestas cortas. */
export function Ayuda({ cerrar, secciones, con, ir, verRecorrido, probarConexiones }: { cerrar: () => void; secciones: SeccionAyuda[]; con: Conexion | null; ir: (id: string) => void; verRecorrido: () => void; probarConexiones: () => void }) {
  const pasos = [
    { texto: 'Conectar GitHub', ok: Boolean(con?.github.conectado), accion: probarConexiones },
    { texto: 'Conectar ClickUp', ok: Boolean(con?.clickup.conectado), accion: probarConexiones },
    { texto: 'Ver el recorrido', ok: hecho('hilo.recorrido'), accion: verRecorrido },
    { texto: 'Preguntarle algo al asistente', ok: hecho('hilo.pregunto'), accion: () => ir('asistente') },
  ];
  const hechos = pasos.filter((p) => p.ok).length;
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

        <section>
          <h3>Qué hace cada sección</h3>
          <div className="mini-secciones">
            {secciones.map((s) => (
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

        <section>
          <h3>Preguntas rápidas</h3>
          {PREGUNTAS.map(([p, r]) => (
            <details key={p} className="pregunta">
              <summary>{p}</summary>
              <p>{r}</p>
            </details>
          ))}
        </section>

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
