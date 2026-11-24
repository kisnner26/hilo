import { useEffect, useState } from 'react';
import { api, type UsoVista } from '../lib/api';

const TECNICAS: Record<string, string> = {
  'registro-ci': 'Registros de CI reducidos al fallo',
  diff: 'Diffs comprimidos',
  revision: 'Comentarios de revisión compactos',
  'paso-local': 'Pasos resueltos sin modelo',
  'cache-de-paso': 'Pasos idénticos reutilizados',
  extracto: 'Notas recortadas',
};

const miles = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)} k` : String(n));

/** Lo gastado de verdad (lo cuenta la CLI del agente) frente a lo que Hilo evitó mandar. */
export function UsoReal({ compacto = false }: { compacto?: boolean }) {
  const [u, setU] = useState<UsoVista | null>(null);
  useEffect(() => void api.usoResumen().then(setU), []);
  if (!u) return null;
  const vacio = u.pasos === 0;
  const maximo = Math.max(1, ...u.porTecnica.map((t) => t.tokens));
  const gastado = u.entrada + u.cacheLeida;
  return (
    <section className="conexion uso-real">
      <header>
        <b>Lo que gastaste y lo que no gastaste</b>
        <span className="suave">Últimos 30 días</span>
      </header>
      {vacio ? (
        <p className="suave">Aún no hay pasos registrados. Cuando uses el piloto automático o el asistente, aquí verás los tokens reales que informó tu agente y los que Hilo evitó mandar.</p>
      ) : (
        <>
          <div className="uso-cifras">
            <div>
              <strong>{miles(gastado + u.salida)}</strong>
              <span>tokens gastados</span>
            </div>
            <div className="bueno">
              <strong>{miles(u.tokensEvitados)}</strong>
              <span>tokens que no mandaste</span>
            </div>
            <div>
              <strong>{Math.round(u.ahorro * 100)} %</strong>
              <span>menos entrada</span>
            </div>
            <div>
              <strong>{u.locales}</strong>
              <span>de {u.pasos} pasos sin modelo</span>
            </div>
          </div>
          <div className="barra-medidor">
            <i style={{ width: `${Math.round(u.ahorro * 100)}%` }} />
          </div>
          {!compacto && (
            <>
              <ul className="uso-tecnicas">
                {u.porTecnica.map((t) => (
                  <li key={t.tecnica}>
                    <span>{TECNICAS[t.tecnica] ?? t.tecnica}</span>
                    <div className="barra-medidor chica">
                      <i style={{ width: `${(t.tokens / maximo) * 100}%` }} />
                    </div>
                    <em>{miles(t.tokens)}</em>
                  </li>
                ))}
              </ul>
              <p className="suave nota-uso">
                Lo gastado lo cuenta la propia CLI de tu agente al terminar cada paso{u.costoUsd > 0 ? ` (≈ ${u.costoUsd.toFixed(2)} USD de uso equivalente)` : ''}. Lo evitado compara el texto crudo con el que Hilo mandó, a razón de 4 caracteres por token: es una estimación, no una factura.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
