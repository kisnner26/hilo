import { useEffect, useState } from 'react';
import { api, type DescargaVoz, type EstadoDictado, type IdiomaVoz } from '../lib/api';

const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
export const NOMBRE_IDIOMA: Record<string, string> = { es: 'Español', en: 'English', auto: 'Automático' };

/** Elige el idioma del dictado. En automático, Whisper detecta si hablas español o inglés. */
export function SelectorIdioma({ valor, alCambiar, motor }: { valor: IdiomaVoz; alCambiar: (i: IdiomaVoz) => void; motor: string }) {
  const opciones: IdiomaVoz[] = motor === 'whisper' ? ['auto', 'es', 'en'] : ['es', 'en'];
  const actual = opciones.includes(valor) ? valor : opciones[0]!;
  return (
    <span className="selector-idioma" role="group" aria-label="Idioma del dictado">
      {opciones.map((o) => (
        <button key={o} type="button" className={actual === o ? 'activo' : ''} onClick={() => alCambiar(o)} title={o === 'auto' ? 'Detecta si hablas español o inglés' : `Entender ${NOMBRE_IDIOMA[o]}`}>
          {o === 'auto' ? 'Auto' : o.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/** Qué motor de voz hay y cómo conseguir el mejor. */
export function PanelVoz({ estado, refrescar }: { estado: EstadoDictado | null; refrescar: () => void }) {
  const [d, setD] = useState<DescargaVoz | null>(null);
  const [copiado, setCopiado] = useState(false);
  useEffect(
    () =>
      api.alDescarga((e) => {
        setD(e);
        if (e.listo) refrescar();
      }),
    [refrescar],
  );
  if (!estado) return null;
  const bajando = d !== null && !d.listo && !d.error;
  return (
    <div className="panel-voz">
      <div className="estado-motor">
        <span className={`punto-motor ${estado.motor === 'whisper' ? 'ok' : 'medio'}`} aria-hidden="true" />
        <div>
          <b>{estado.motor === 'whisper' ? 'Whisper: inglés y español, en tu equipo' : estado.motor === 'apple' ? 'Reconocimiento de Apple' : 'Sin dictado en este equipo'}</b>
          <span className="suave">
            {estado.motor === 'whisper'
              ? 'Detecta solo el idioma, entiende mejor y el audio no sale de tu Mac.'
              : estado.motor === 'apple'
                ? 'Funciona con un idioma a la vez. Para entender inglés y español sin elegir, usa Whisper.'
                : 'Instala Whisper para dictar, o usa el dictado de tu sistema.'}
          </span>
        </div>
      </div>
      {estado.motor !== 'whisper' && (
        <ol className="pasos-voz">
          <li className={estado.whisper.herramienta ? 'hecho' : ''}>
            <span>Instalar la herramienta</span>
            {!estado.whisper.herramienta && (
              <button
                className="boton secundario"
                onClick={async () => {
                  await api.copiar('brew install whisper-cpp');
                  setCopiado(true);
                }}
              >
                {copiado ? 'Copiado: pégalo en la terminal' : 'Copiar: brew install whisper-cpp'}
              </button>
            )}
          </li>
          <li className={estado.whisper.modelo ? 'hecho' : ''}>
            <span>Descargar el modelo multilingüe (181 MB, una sola vez)</span>
            {!estado.whisper.modelo && (
              <button className="boton" disabled={bajando} onClick={() => void api.dictadoDescargarModelo()}>
                {bajando && d?.total ? `Descargando ${mb(d.bajados ?? 0)} de ${mb(d.total)}` : bajando ? 'Descargando…' : 'Descargar el modelo'}
              </button>
            )}
          </li>
        </ol>
      )}
      {d?.error && <p className="mal">No se pudo descargar: {d.error}</p>}
      {bajando && d?.total ? (
        <div className="barra-medidor">
          <i style={{ width: `${Math.round(((d.bajados ?? 0) / d.total) * 100)}%` }} />
        </div>
      ) : null}
      {estado.motor !== 'whisper' && <p className="suave nota-uso">Se descarga de huggingface.co (ggml-small-q5_1.bin) y se guarda en los datos de Hilo. Después funciona sin internet.</p>}
    </div>
  );
}
