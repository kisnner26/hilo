import { useEffect, useState } from 'react';
import { api, type EstadoMotores, type MotorId, type NivelPermisos } from '../lib/api';

const NIVELES: { id: NivelPermisos; nombre: string; detalle: string; aviso?: string }[] = [
  { id: 'lectura', nombre: 'Solo lectura', detalle: 'Lee archivos y propone. No ejecuta nada.' },
  { id: 'trabajo', nombre: 'Trabajo', detalle: 'Lee GitHub (gh en solo lectura), edita archivos del proyecto, corre pruebas y guarda commits locales. No publica ni borra.' },
  { id: 'total', nombre: 'Total', detalle: 'Como Claude Code o Codex con los permisos abiertos: comandos, git push, gh, red y publicar, sin preguntarte antes.', aviso: 'Úsalo solo en tu equipo y con proyectos de confianza: un archivo o un comentario ajeno con instrucciones escondidas podría hacer que el agente las ejecute.' },
];

const COMANDO = /(brew install [\w-]+|ollama pull [\w.:-]+|npm i -g [\w@/.-]+)/;

/** Qué IA se está usando y por qué. Hilo la elige solo; aquí se ve y se cambia. */
export function MotorIA() {
  const [e, setE] = useState<EstadoMotores | null>(null);
  const [mirando, setMirando] = useState(false);
  const [copiado, setCopiado] = useState('');
  const mirar = async (forzar: boolean) => {
    setMirando(true);
    try {
      setE(await api.motorEstado(forzar));
    } finally {
      setMirando(false);
    }
  };
  useEffect(() => void mirar(false), []);
  if (!e) return null;
  const fijar = async (id: 'auto' | MotorId) => {
    await api.motorFijar(id);
    await mirar(true);
  };
  const elegido = e.lista.find((m) => m.id === e.elegido);
  const auto = e.preferido === 'auto';
  return (
    <section className="conexion destacada motor-ia">
      <header>
        <b>Motor de IA</b>
        <button className="boton secundario" onClick={() => void mirar(true)} disabled={mirando}>
          {mirando ? 'Mirando…' : 'Volver a mirar'}
        </button>
      </header>
      <p className="suave">
        Hilo usa el mejor que encuentre: primero tu agente de suscripción, y si no hay, un modelo que corre en tu propio equipo. Ahora usa <b>{elegido?.nombre}</b>
        {elegido?.local ? ', en tu equipo.' : '.'}
      </p>
      <ul className="lista-motores" role="radiogroup" aria-label="Motor de IA">
        <li className={auto ? 'elegido' : ''}>
          <button role="radio" aria-checked={auto} onClick={() => void fijar('auto')}>
            <span className="radio" aria-hidden="true" />
            <div>
              <b>Automático</b>
              <span className="suave">Recomendado. Se adapta si conectas o instalas algo después.</span>
            </div>
          </button>
        </li>
        {e.lista.map((m) => {
          const cmd = m.ayuda ? COMANDO.exec(m.ayuda)?.[1] : undefined;
          const activo = !auto && e.preferido === m.id;
          return (
            <li key={m.id} className={`${activo ? 'elegido' : ''}${m.disponible ? '' : ' apagado'}`}>
              <button role="radio" aria-checked={activo} disabled={!m.disponible} onClick={() => void fijar(m.id)}>
                <span className="radio" aria-hidden="true" />
                <div>
                  <b>
                    {m.nombre} <em className={`etiqueta-motor ${m.local ? 'local' : 'nube'}`}>{m.id === 'reglas' ? 'sin IA' : m.local ? 'en tu equipo' : 'suscripción'}</em>
                    {e.elegido === m.id && <em className="etiqueta-motor usando">en uso</em>}
                  </b>
                  <span className="suave">{m.detalle}</span>
                  {!m.disponible && m.ayuda && <span className="ayuda-motor">{m.ayuda}</span>}
                </div>
              </button>
              {cmd && !m.disponible && (
                <button
                  className="boton secundario"
                  onClick={async () => {
                    await api.copiar(cmd);
                    setCopiado(m.id);
                  }}
                >
                  {copiado === m.id ? 'Copiado' : 'Copiar comando'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {e.ollama.activo && e.ollama.modelos.length > 1 && (
        <div className="fila-ajuste-grande">
          <span>Modelo de Ollama</span>
          <select
            className="campo"
            value={e.ollama.elegido ?? ''}
            onChange={(ev) => void api.motorOllamaModelo(ev.target.value).then(() => mirar(true))}
          >
            {e.ollama.modelos.map((m) => (
              <option key={m.nombre} value={m.nombre}>
                {m.nombre} · {(m.bytes / 1e9).toFixed(1)} GB
              </option>
            ))}
          </select>
          <span />
        </div>
      )}
      <div className="permisos-agente">
        <h4>Permisos del agente</h4>
        <p className="suave">Qué puede hacer por su cuenta el agente del asistente (Claude Code o Codex), sin que abras sus aplicaciones.</p>
        <ul className="lista-motores" role="radiogroup" aria-label="Permisos del agente">
          {NIVELES.map((n) => (
            <li key={n.id} className={e.permisos === n.id ? 'elegido' : ''}>
              <button
                role="radio"
                aria-checked={e.permisos === n.id}
                onClick={async () => {
                  await api.motorPermisos({ permisos: n.id });
                  await mirar(true);
                }}
              >
                <span className="radio" aria-hidden="true" />
                <div>
                  <b>
                    {n.nombre} {n.id === 'trabajo' && <em className="etiqueta-motor usando">recomendado</em>}
                  </b>
                  <span className="suave">{n.detalle}</span>
                  {e.permisos === n.id && n.aviso && <span className="ayuda-motor">{n.aviso}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="fila-interruptor">
          <div>
            <b>El piloto automático publica solo</b>
            <span className="suave">Lo que prepara (comentarios, ramas, PR) sale sin pasar por la bandeja de aprobación.</span>
          </div>
          <button
            className={`interruptor${e.pilotoPublicaSolo ? ' si' : ''}`}
            role="switch"
            aria-checked={e.pilotoPublicaSolo}
            onClick={async () => {
              await api.motorPermisos({ pilotoPublicaSolo: !e.pilotoPublicaSolo });
              await mirar(true);
            }}
          >
            {e.pilotoPublicaSolo ? 'Sí' : 'No'}
          </button>
        </div>
      </div>
      <p className="suave nota-uso">
        Un modelo local es más modesto: sirve para redactar, resumir y responder con tus datos, pero editar código y arreglar el CI siguen necesitando Claude Code o Codex.
      </p>
    </section>
  );
}
