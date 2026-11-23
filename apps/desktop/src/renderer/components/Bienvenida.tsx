import { useEffect, useState } from 'react';
import { api, type Conexion } from '../lib/api';

type Paso = 'github' | 'clickup' | 'listo';

/**
 * Primer arranque: lo primero es conectar GitHub y ClickUp, porque sin eso Hilo no puede mostrar datos reales.
 */
export function Bienvenida({ alTerminar, alOmitir }: { alTerminar: () => void; alOmitir: () => void }) {
  const [c, setC] = useState<Conexion | null>(null);
  const [paso, setPaso] = useState<Paso>('github');
  const [codigo, setCodigo] = useState<{ codigo: string; url: string } | null>(null);
  const [tokenGh, setTokenGh] = useState('');
  const [tokenCu, setTokenCu] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [msg, setMsg] = useState('');

  const cargar = async () => {
    const x = await api.conexion();
    setC(x);
    return x;
  };
  useEffect(() => {
    void cargar().then((x) => setPaso(!x.github.conectado ? 'github' : !x.clickup.conectado ? 'clickup' : 'listo'));
    return api.alCodigo(setCodigo);
  }, []);

  const correr = async (nombre: string, f: () => Promise<unknown>, siguiente?: (x: Conexion) => Paso) => {
    setOcupado(nombre);
    setMsg('');
    try {
      await f();
      const x = await cargar();
      if (siguiente) setPaso(siguiente(x));
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setOcupado('');
    }
  };

  const gh = c?.github;
  const cu = c?.clickup;
  const pasos: { id: Paso; nombre: string; hecho: boolean }[] = [
    { id: 'github', nombre: 'GitHub', hecho: Boolean(gh?.conectado) },
    { id: 'clickup', nombre: 'ClickUp', hecho: Boolean(cu?.conectado) },
    { id: 'listo', nombre: 'Listo', hecho: Boolean(gh?.conectado && cu?.conectado) },
  ];

  return (
    <div className="velo">
      <div className="bienvenida vidrio-fuerte" role="dialog" aria-label="Bienvenida a Hilo">
        <p className="etiqueta-bienvenida">Bienvenido a Hilo</p>
        <h1>Primero, conecta tus cuentas</h1>
        <p className="suave grande">Con GitHub y ClickUp conectados, Hilo muestra tus datos reales: tus tareas, tus PR y qué te toca hacer ahora. Son dos pasos y solo se hacen una vez.</p>

        <ol className="pasos-bienvenida">
          {pasos.map((p, i) => (
            <li key={p.id} className={`${paso === p.id ? 'actual' : ''}${p.hecho ? ' hecho' : ''}`}>
              <span className="numero">{p.hecho ? '✓' : i + 1}</span>
              {p.nombre}
            </li>
          ))}
        </ol>

        {paso === 'github' && (
          <section className="paso-cuerpo">
            <h2>Conecta GitHub</h2>
            {gh?.conectado ? (
              <p className="bien">Conectado como {gh.login}.</p>
            ) : gh?.ghInstalado ? (
              <>
                <p className="suave">Se abre el navegador para que autorices con tu cuenta. Hilo no ve tu contraseña.</p>
                <button className="boton" disabled={ocupado === 'gh'} onClick={() => void correr('gh', () => api.conectarGithub(), (x) => (x.clickup.conectado ? 'listo' : 'clickup'))}>
                  {ocupado === 'gh' ? 'Esperando autorización…' : 'Conectar GitHub'}
                </button>
                {codigo && ocupado === 'gh' && (
                  <p className="codigo">
                    Escribe este código en {codigo.url}: <strong>{codigo.codigo}</strong>
                  </p>
                )}
              </>
            ) : (
              <p className="mal">No encuentro GitHub CLI (gh). Instálalo (macOS: brew install gh · Windows: winget install GitHub.cli) o usa un token personal aquí abajo.</p>
            )}
            {!gh?.conectado && (
              <details className="token-gh">
                <summary>Usar un token personal de GitHub</summary>
                <p className="suave">En github.com: Settings, Developer settings, Personal access tokens. Permisos: Contents y Metadata en lectura, Pull requests en lectura y escritura.</p>
                <div className="fila">
                  <input className="campo" type="password" placeholder="github_pat_… o ghp_…" value={tokenGh} onChange={(e) => setTokenGh(e.target.value)} />
                  <button
                    className="boton secundario"
                    disabled={!tokenGh || ocupado === 'ght'}
                    onClick={() =>
                      void correr(
                        'ght',
                        async () => {
                          await api.githubToken(tokenGh);
                          setTokenGh('');
                        },
                        (x) => (x.clickup.conectado ? 'listo' : 'clickup'),
                      )
                    }
                  >
                    Guardar token
                  </button>
                </div>
              </details>
            )}
          </section>
        )}

        {paso === 'clickup' && (
          <section className="paso-cuerpo">
            <h2>Conecta ClickUp</h2>
            {cu?.conectado ? (
              <p className="bien">Conectado como {cu.usuario}.</p>
            ) : (
              <>
                <p className="suave">En ClickUp: tu foto, Configuración, Apps, Token de API, Generar. Pégalo aquí. Se guarda cifrado con el llavero de tu sistema y solo se usa para leer tus tareas y publicar con tu nombre cuando tú lo confirmes.</p>
                <div className="fila">
                  <input className="campo" type="password" placeholder="pk_…" value={tokenCu} onChange={(e) => setTokenCu(e.target.value)} />
                  <button
                    className="boton"
                    disabled={!tokenCu || ocupado === 'cu'}
                    onClick={() =>
                      void correr(
                        'cu',
                        async () => {
                          await api.clickupToken(tokenCu);
                          setTokenCu('');
                        },
                        () => 'listo',
                      )
                    }
                  >
                    {ocupado === 'cu' ? 'Comprobando…' : 'Conectar ClickUp'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {paso === 'listo' && (
          <section className="paso-cuerpo">
            <h2>Todo conectado</h2>
            <p className="suave">
              GitHub: {gh?.login ?? '—'} · ClickUp: {cu?.usuario ?? '—'}. Hilo ya puede mostrarte tus tareas y tus PR. Te muestro rápido para qué sirve cada cosa.
            </p>
          </section>
        )}

        {msg && <p className="error">{msg}</p>}

        <div className="pie-bienvenida">
          <button className="enlace-suave" onClick={alOmitir}>
            Omitir por ahora
          </button>
          <span className="espacio" />
          {paso !== 'listo' && (
            <button className="boton secundario" onClick={() => setPaso(paso === 'github' ? 'clickup' : 'listo')} disabled={paso === 'github' ? !gh?.conectado : !cu?.conectado}>
              Siguiente
            </button>
          )}
          {paso === 'listo' && (
            <button className="boton" onClick={alTerminar}>
              Ver el recorrido
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
