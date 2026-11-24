import { useCallback, useEffect, useRef, useState } from 'react';
import { api, enElectron, type EventoAuto, type ItemBandejaVista, type PasoAutoVista, type PlanAutoVista } from '../lib/api';
import { UsoReal } from './Uso';

const EJECUTOR = (p: PasoAutoVista) => (p.ejecutor === 'hilo' ? 'Hilo · sin tokens' : p.escritura ? 'Agente · espacio aislado' : 'Agente ligero');
const SALIDA: Record<PasoAutoVista['salida'], string> = {
  ninguna: 'Se hace solo',
  'comentario-github': 'Comentario en GitHub',
  'comentario-clickup': 'Comentario en ClickUp',
  'rama-y-pr': 'Sube la rama y abre un PR en borrador',
  push: 'Sube los commits a tu rama',
  'editar-pr': 'Corrige el título y el cuerpo del PR',
};
const DIAS = (n: number) => (n <= 0 ? '' : ` · ${n} día${n === 1 ? '' : 's'}`);

type EstadoPaso = { estado: NonNullable<EventoAuto['estado']> | 'espera'; texto?: string };

function ItemListo({ i, marcado, alMarcar, alPublicar, alDescartar }: { i: ItemBandejaVista; marcado: boolean; alMarcar: () => void; alPublicar: () => void; alDescartar: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const error = i.estado === 'error';
  return (
    <li className={`item-bandeja${error ? ' con-error' : ''}`}>
      <div className="item-cabeza">
        {!error && <input type="checkbox" checked={marcado} onChange={alMarcar} aria-label={`Elegir ${i.paso.titulo}`} />}
        <div className="item-titulo">
          <b>{i.paso.titulo}</b>
          <span className="suave">
            {error ? i.texto : (i.detalle?.resumen ?? SALIDA[i.paso.salida])}
            {i.modelo ? ` · ${i.modelo}` : ''}
            {i.costoUsd ? ` · ${i.costoUsd.toFixed(2)} USD` : ''}
          </span>
        </div>
        <span className="botones-accion">
          <button className="boton secundario" onClick={() => setAbierto(!abierto)}>
            {abierto ? 'Cerrar' : 'Ver'}
          </button>
          {!error && (
            <button className="boton" onClick={alPublicar}>
              Aprobar
            </button>
          )}
          <button className="boton secundario" onClick={alDescartar}>
            Descartar
          </button>
        </span>
      </div>
      {abierto && !error && (
        <div className="preparado">
          {i.detalle?.verificacion && <p className={`verificacion ${i.detalle.verificacion.startsWith('Pasó') ? 'ok' : 'mal'}`}>{i.detalle.verificacion}</p>}
          {i.detalle?.archivos && <p className="suave mono">{i.detalle.archivos.join('\n')}</p>}
          <pre className="texto-item">{i.texto}</pre>
          <div className="fila">
            <button className="boton secundario" onClick={() => void api.copiar(i.texto)}>
              Copiar
            </button>
            <span className="suave">{SALIDA[i.paso.salida]}. Antes de salir, te muestro un resumen para confirmar.</span>
          </div>
        </div>
      )}
    </li>
  );
}

export function Autopiloto({ version }: { version: number }) {
  const [plan, setPlan] = useState<PlanAutoVista | null>(null);
  const [bandeja, setBandeja] = useState<ItemBandejaVista[]>([]);
  const [estados, setEstados] = useState<Record<string, EstadoPaso>>({});
  const [corriendo, setCorriendo] = useState(false);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState('');
  const [verPasos, setVerPasos] = useState(false);
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    const [p, b] = await Promise.all([api.autoPlan(), api.autoBandeja()]);
    if (!vivo.current) return;
    setPlan(p);
    setBandeja(b);
    setCorriendo(Boolean(p.corriendo));
    setElegidos((prev) => new Set([...prev].filter((id) => b.some((x) => x.id === id && x.estado === 'listo'))));
  }, []);

  useEffect(() => {
    vivo.current = true;
    void cargar().catch((e: unknown) => setAviso(String(e instanceof Error ? e.message : e)));
    const quitar = api.alAuto((e) => {
      if (e.tipo === 'inicio') setEstados({});
      if (e.tipo === 'paso' && e.id) setEstados((s) => ({ ...s, [e.id!]: { estado: e.estado ?? 'corriendo', ...(e.texto ? { texto: e.texto } : {}) } }));
      if (e.tipo === 'delta' && e.id) setEstados((s) => ({ ...s, [e.id!]: { estado: 'corriendo', texto: `${s[e.id!]?.texto ?? ''}${e.texto ?? ''}`.slice(-220) } }));
      if (e.tipo === 'paso' && e.item) setBandeja((b) => [e.item!, ...b.filter((x) => x.id !== e.item!.id)]);
      if (e.tipo === 'fin') {
        setCorriendo(false);
        setAviso(e.listos ? `${e.listos} cosa${e.listos === 1 ? '' : 's'} lista${e.listos === 1 ? '' : 's'} para aprobar.` : 'Terminé: no quedó nada nuevo para aprobar.');
        void cargar();
      }
    });
    return () => {
      vivo.current = false;
      quitar();
    };
  }, [cargar, version]);

  const correr = async () => {
    setAviso('');
    setCorriendo(true);
    setEstados(Object.fromEntries((plan?.pasos ?? []).map((p) => [p.id, { estado: 'espera' as const }])));
    try {
      await api.autoCorrer();
      if (!enElectron) {
        setCorriendo(false);
        setAviso('Demostración: en la app real, aquí corren los pasos y llegan a la bandeja.');
      }
    } catch (e) {
      setCorriendo(false);
      setAviso(String(e instanceof Error ? e.message : e));
    }
  };
  const publicar = async (ids: string[]) => {
    setAviso('');
    try {
      const r = await api.autoPublicar(ids);
      setAviso(r.errores.length ? r.errores.join(' · ') : r.publicados ? `${r.publicados} publicad${r.publicados === 1 ? 'o' : 'os'}.` : 'No se publicó nada.');
    } catch (e) {
      setAviso(String(e instanceof Error ? e.message : e));
    }
    await cargar();
  };

  if (!plan) return null;
  const listos = bandeja.filter((b) => b.estado === 'listo');
  const errores = bandeja.filter((b) => b.estado === 'error').slice(0, 3);
  const gratis = plan.pasos.filter((p) => p.ejecutor === 'hilo').length;
  const conAgente = plan.pasos.length - gratis;
  const frenan = plan.culpables;
  const tuyos = plan.bloqueos.filter((b) => b.tuTurno);

  return (
    <div className="autopiloto">
      <section className="piloto">
        <div className="piloto-cabeza">
          <div>
            <h3>Piloto automático</h3>
            <span className="suave">
              {plan.pasos.length === 0 ? 'No hay nada que preparar ahora mismo.' : `${plan.pasos.length} paso${plan.pasos.length === 1 ? '' : 's'}: ${gratis} sin tokens y ${conAgente} con agente. No publica nada sin tu aprobación.`}
            </span>
          </div>
          {corriendo ? (
            <button className="boton secundario" onClick={() => void api.autoCancelar()}>
              Cancelar
            </button>
          ) : (
            <button className="boton grande" onClick={() => void correr()} disabled={plan.pasos.length === 0}>
              Hacer mis pendientes
            </button>
          )}
        </div>
        {(plan.omitidos?.length ?? 0) > 0 && (
          <p className="aviso-omitidos">
            {plan.omitidos!.length} paso{plan.omitidos!.length === 1 ? '' : 's'} más {plan.omitidos!.length === 1 ? 'necesita' : 'necesitan'} un agente: {plan.omitidos![0]!.motivo}
          </p>
        )}
        {plan.pasos.length > 0 && (
          <>
            <button className="enlace" onClick={() => setVerPasos(!verPasos)}>
              {verPasos || corriendo ? 'Ocultar los pasos' : 'Ver los pasos'}
            </button>
            {(verPasos || corriendo) && (
              <ol className="pasos-auto">
                {plan.pasos.map((p) => {
                  const e = estados[p.id];
                  return (
                    <li key={p.id} className={e?.estado ?? ''}>
                      <span className={`punto ${e?.estado ?? 'espera'}`} />
                      <div>
                        <b>{p.titulo}</b>
                        <span className="suave">
                          {EJECUTOR(p)} · {SALIDA[p.salida]}
                        </span>
                        {e?.texto && e.estado === 'corriendo' && <span className="en-vivo">{e.texto}</span>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
        {aviso && <p className="suave aviso-piloto">{aviso}</p>}
      </section>

      {(frenan.length > 0 || tuyos.length > 0) && (
        <section className="frenos">
          <h3>Quién te frena</h3>
          {frenan.length === 0 ? <p className="vacio-chico">Nadie: lo que falta depende de ti.</p> : (
            <ul className="culpables">
              {frenan.map((c) => (
                <li key={c.quien}>
                  <b>{c.quien}</b>
                  <span className="suave">
                    frena {c.tareas.join(', ')}
                    {DIAS(c.masAntiguo)}
                  </span>
                  <span className="dist">{c.bloqueos}</span>
                </li>
              ))}
            </ul>
          )}
          {tuyos.length > 0 && (
            <ul className="tu-turno">
              {tuyos.slice(0, 4).map((b) => (
                <li key={`${b.tipo}${b.tarea}${b.pr ?? ''}`}>
                  <span className="dist mal">te toca</span>
                  <span>
                    {b.tarea}: {b.causa}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(listos.length > 0 || errores.length > 0) && (
        <section className="bandeja">
          <div className="bandeja-cabeza">
            <h3>Para aprobar ({listos.length})</h3>
            {listos.length > 0 && (
              <span className="fila">
                <button className="boton secundario" onClick={() => void api.autoDescartar(listos.map((x) => x.id)).then(cargar)}>
                  Descartar todo
                </button>
                <button className="boton" onClick={() => void publicar((elegidos.size ? [...elegidos] : listos.map((x) => x.id)).filter((id) => listos.some((x) => x.id === id && x.paso.salida !== 'ninguna')))}>
                  {elegidos.size ? `Aprobar ${elegidos.size}` : 'Aprobar todo'}
                </button>
              </span>
            )}
          </div>
          <ul className="lista-bandeja">
            {[...listos, ...errores].map((i) => (
              <ItemListo
                key={i.id}
                i={i}
                marcado={elegidos.has(i.id)}
                alMarcar={() => setElegidos((s) => (s.has(i.id) ? new Set([...s].filter((x) => x !== i.id)) : new Set(s).add(i.id)))}
                alPublicar={() => void publicar([i.id])}
                alDescartar={() => void api.autoDescartar([i.id]).then(cargar)}
              />
            ))}
          </ul>
        </section>
      )}
      <UsoReal compacto />
    </div>
  );
}
