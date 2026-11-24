import { useState } from 'react';
import { PreguntarAgente } from './PreguntarAgente';
import { api, type ColaVista, type PlanVista } from '../lib/api';

export function Tablero() {
  const [cola, setCola] = useState<ColaVista | null>(null);
  const [plan, setPlan] = useState<PlanVista | null>(null);
  const [dias, setDias] = useState(10);
  const [capacidad, setCapacidad] = useState(500);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState('');
  const correr = async (n: string, f: () => Promise<void>) => {
    setOcupado(n);
    setError('');
    try {
      await f();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setOcupado('');
    }
  };
  return (
    <div className="columna ancha">
      <div className="fila-titulo">
        <h2>Tablero</h2>
        <PreguntarAgente etiqueta="¿Qué reviso primero?" pedido={{ mostrar: '¿Qué PR reviso primero y por qué?', texto: '¿Qué PR debería revisar primero y por qué? Considera tamaño, rondas y quién espera.' }} />
      </div>

      <h3>Cola de revisión</h3>
      <button className="boton secundario" disabled={ocupado === 'cola'} onClick={() => void correr('cola', async () => setCola(await api.cola()))}>
        {ocupado === 'cola' ? 'Calculando…' : 'Cargar cola'}
      </button>
      {cola && (
        <>
          <p className="suave">
            {cola.metricas.prs} PR abiertos · {cola.metricas.rondasPromedio.toFixed(1)} rondas de revisión en promedio · {cola.metricas.conMasDeTresRondas.length} con más de 3 rondas
          </p>
          <table className="tabla">
            <thead>
              <tr>
                <th>PR</th>
                <th>Autor</th>
                <th>Líneas</th>
                <th>Rondas</th>
                <th>Estado</th>
                <th>Propuesta</th>
              </tr>
            </thead>
            <tbody>
              {cola.cola.map((p) => (
                <tr key={p.numero}>
                  <td>#{p.numero}</td>
                  <td>{p.autor}</td>
                  <td className={p.lineas > 400 ? 'mal' : ''}>{p.lineas}</td>
                  <td className={p.rondas > 3 ? 'mal' : ''}>{p.rondas}</td>
                  <td>{p.listo ? 'listo' : 'borrador'}</td>
                  <td>{cola.asignaciones.find((a) => a.numero === p.numero)?.integrador ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>Plan por días</h3>
      <div className="fila">
        <label className="suave">
          Días{' '}
          <input className="campo corto" type="number" min={1} max={30} value={dias} onChange={(e) => setDias(Number(e.target.value))} />
        </label>
        <label className="suave">
          Líneas por día{' '}
          <input className="campo corto" type="number" min={100} step={100} value={capacidad} onChange={(e) => setCapacidad(Number(e.target.value))} />
        </label>
        <button className="boton" disabled={ocupado === 'plan'} onClick={() => void correr('plan', async () => setPlan(await api.plan({ dias, capacidad })))}>
          {ocupado === 'plan' ? 'Armando…' : 'Armar plan'}
        </button>
      </div>
      {plan && (
        <>
          <p className="suave">
            {plan.tareas} tareas de ClickUp · líneas estimadas por tipo.
            {plan.desbordes.length > 0 ? ` Los días ${plan.desbordes.join(', ')} pasan la capacidad: recorta alcance.` : ''}
          </p>
          <table className="tabla">
            <tbody>
              {plan.plan
                .filter((d) => d.piezas.length > 0)
                .map((d) => (
                  <tr key={d.dia}>
                    <td className="mono">Día {d.dia}</td>
                    <td>{d.piezas.map((p) => `${p.codigo} (${p.lineas})`).join(' · ')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
