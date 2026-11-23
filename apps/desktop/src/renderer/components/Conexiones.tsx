import { useEffect, useState } from 'react';
import { api, type Conexion } from '../lib/api';

/** Conecta las cuentas de la persona. Con GitHub y ClickUp conectados, Hilo sabe quién es y qué le toca. */
export function Conexiones({ alCambiar }: { alCambiar: () => void }) {
  const [c, setC] = useState<Conexion | null>(null);
  const [codigo, setCodigo] = useState<{ codigo: string; url: string } | null>(null);
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [msg, setMsg] = useState('');
  const [listas, setListas] = useState<{ id: string; nombre: string; espacio: string }[] | null>(null);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState('');
  const [tokenGh, setTokenGh] = useState('');

  const cargar = () => void api.conexion().then(setC);
  useEffect(() => {
    cargar();
    return api.alCodigo(setCodigo);
  }, []);
  const correr = async (nombre: string, f: () => Promise<unknown>) => {
    setOcupado(nombre);
    setMsg('');
    try {
      await f();
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setOcupado('');
      cargar();
      alCambiar();
    }
  };

  if (!c) return <p className="suave">Cargando conexiones…</p>;
  return (
    <div className="conexiones">
      <section className="conexion">
        <header>
          <b>GitHub</b>
          <span className={c.github.conectado ? 'bien' : 'mal'}>{c.github.conectado ? `Conectado como ${c.github.login}${c.github.origen === 'token' ? ' · token' : ' · gh'}` : 'Sin conectar'}</span>
        </header>
        {!c.github.conectado && (
          <>
            {c.github.error && <p className="error">{c.github.error}</p>}
            {c.github.ghInstalado ? (
              <>
                <p className="suave">Se abre el navegador para que autorices con tu cuenta. Hilo no ve tu contraseña.</p>
                <button className="boton" disabled={ocupado === 'gh'} onClick={() => void correr('gh', () => api.conectarGithub())}>
                  {ocupado === 'gh' ? 'Esperando autorización…' : 'Conectar GitHub'}
                </button>
                {codigo && ocupado === 'gh' && (
                  <p className="codigo">
                    Escribe este código en {codigo.url}: <strong>{codigo.codigo}</strong>
                  </p>
                )}
              </>
            ) : (
              <p className="mal">GitHub CLI (gh) no está instalado. Instálalo (macOS: brew install gh · Windows: winget install GitHub.cli) o usa un token personal, aquí abajo.</p>
            )}
            <details className="token-gh">
              <summary>Usar un token personal de GitHub</summary>
              <p className="suave">
                En github.com, Settings, Developer settings, Personal access tokens. Permisos: Contents y Metadata en lectura, y Pull requests en lectura y escritura sobre el repositorio. Se guarda cifrado con el llavero.
              </p>
              <div className="fila">
                <input className="campo" type="password" placeholder="github_pat_… o ghp_…" value={tokenGh} onChange={(e) => setTokenGh(e.target.value)} />
                <button
                  className="boton secundario"
                  disabled={!tokenGh || ocupado === 'ghtoken'}
                  onClick={() =>
                    void correr('ghtoken', async () => {
                      await api.githubToken(tokenGh);
                      setTokenGh('');
                    })
                  }
                >
                  Guardar token
                </button>
              </div>
            </details>
          </>
        )}
        {c.github.conectado && c.github.origen === 'token' && (
          <button className="boton secundario" onClick={() => void correr('ghtoken', () => api.githubBorrarToken())}>
            Quitar el token guardado
          </button>
        )}
        <h4>Repositorios</h4>
        <div className="lista-repos">
          {c.repos.length === 0 && <p className="suave">Usando el repositorio del perfil: {c.repo}</p>}
          {c.repos.map((r) => (
            <div key={r} className={`repo${r === c.repo ? ' activo' : ''}`}>
              <button className="item-arbol" onClick={() => void correr('repo', () => api.elegirRepo(r))}>
                {r}
                {r === c.repo ? ' · activo' : ''}
              </button>
              <button className="cerrar" onClick={() => void correr('repo', () => api.quitarRepo(r))} aria-label={`Quitar ${r}`}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="fila">
          <input className="campo" placeholder="dueño/nombre o dirección de GitHub" value={repo} onChange={(e) => setRepo(e.target.value)} />
          <button
            className="boton secundario"
            disabled={!repo || ocupado === 'repo'}
            onClick={() =>
              void correr('repo', async () => {
                await api.agregarRepo(repo);
                setRepo('');
              })
            }
          >
            Agregar
          </button>
        </div>
      </section>

      <section className="conexion">
        <header>
          <b>ClickUp</b>
          <span className={c.clickup.conectado ? 'bien' : 'mal'}>{c.clickup.conectado ? `Conectado como ${c.clickup.usuario}` : 'Sin conectar'}</span>
        </header>
        {!c.clickup.conectado ? (
          <>
            <p className="suave">
              En ClickUp: tu foto, Configuración, Apps, Token de API. Pégalo aquí. Se guarda cifrado con el llavero de tu sistema y solo se usa para leer y publicar con tu nombre.
            </p>
            <div className="fila">
              <input className="campo" type="password" placeholder="pk_…" value={token} onChange={(e) => setToken(e.target.value)} />
              <button
                className="boton"
                disabled={!token || ocupado === 'cu'}
                onClick={() =>
                  void correr('cu', async () => {
                    await api.clickupToken(token);
                    setToken('');
                  })
                }
              >
                Conectar ClickUp
              </button>
            </div>
            {c.clickup.error && <p className="error">{c.clickup.error}</p>}
          </>
        ) : (
          <>
            <div className="fila">
              <button
                className="boton secundario"
                onClick={() =>
                  void correr('listas', async () => {
                    const r = await api.clickupListas();
                    setListas(r.listas);
                    setElegidas(r.elegidas);
                  })
                }
              >
                Elegir qué listas seguir
              </button>
              <button className="boton secundario" onClick={() => void correr('cu', () => api.clickupBorrar())}>
                Desconectar
              </button>
            </div>
            {listas && (
              <div className="listas-clickup">
                {listas.map((l) => (
                  <label key={l.id} className="casilla">
                    <input type="checkbox" checked={elegidas.includes(l.id)} onChange={(e) => setElegidas(e.target.checked ? [...elegidas, l.id] : elegidas.filter((x) => x !== l.id))} /> {l.espacio} · {l.nombre}
                  </label>
                ))}
                <button
                  className="boton"
                  onClick={() =>
                    void correr('listas', async () => {
                      await api.elegirListas(elegidas);
                      setListas(null);
                    })
                  }
                >
                  Guardar listas
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {msg && <p className="error">{msg}</p>}
    </div>
  );
}
