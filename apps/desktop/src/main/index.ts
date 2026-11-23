import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, safeStorage, shell } from 'electron';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as core from '@hilo/core';

interface Config {
  perfil?: string;
  grafo?: string;
  boveda?: string;
  /** Clon local del repositorio: es donde trabajan los agentes para poder leer el código. */
  proyecto?: string;
  raiz?: string;
  repo?: string;
  /** Modelo y esfuerzo por función; si falta una, se usa la del perfil. */
  modelos?: Partial<Record<keyof core.Perfil['modelos'], core.ModeloAsignado>>;
  /** Si es falso, los agentes solo leen y proponen. */
  permitirEditar?: boolean;
  /** Rol de quien usa la app: decide qué acciones se le permiten. */
  rol?: core.RolId;
  /** Token personal de ClickUp, cifrado con el llavero del sistema. */
  clickupToken?: string;
  /** Token personal de GitHub pegado a mano (si no, se usa el de `gh`), cifrado con el llavero. */
  githubToken?: string;
  /** Repositorios conectados (dueño/nombre); `repo` es el activo. */
  repos?: string[];
  /** Listas de ClickUp que se siguen. Si no hay, se usan las del perfil. */
  listasClickup?: string[];
  avisos?: boolean;
  /** Repositorio donde se publican los releases de Hilo, para contar descargas. */
  repoHilo?: string;
}

// Una app abierta desde el Dock no hereda el PATH de la terminal: sin esto no se encuentran gh, claude ni codex.
core.prepararPath();
void core.ampliarPath();

app.setName('Hilo');
const rutaConfig = () => join(app.getPath('userData'), 'config.json');

function leerConfig(): Config {
  try {
    return JSON.parse(readFileSync(rutaConfig(), 'utf8')) as Config;
  } catch {
    return {};
  }
}
function guardarConfig(c: Config): Config {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(rutaConfig(), `${JSON.stringify(c, null, 2)}\n`);
  return c;
}

function rutaPerfilIncluido(): string {
  return app.isPackaged ? join(process.resourcesPath, 'profiles', 'sistema-evaluaciones.json') : resolve(__dirname, '../../../../profiles/sistema-evaluaciones.json');
}
function perfilActual(): core.Perfil {
  const c = leerConfig();
  const base = core.cargarPerfil(c.perfil && existsSync(c.perfil) ? c.perfil : rutaPerfilIncluido());
  return { ...base, modelos: { ...base.modelos, ...(c.modelos as core.Perfil['modelos'] | undefined) } };
}
const raizDatos = () => leerConfig().raiz ?? join(app.getPath('documents'), 'Hilo');

function cargarTodo(): { grafo: core.Grafo; notas: core.Nota[] } {
  const c = leerConfig();
  let grafo: core.Grafo = c.grafo && existsSync(c.grafo) ? core.nombrarComunidades(core.cargarGrafo(c.grafo)) : { nodos: [], enlaces: [] };
  const notas = c.boveda && existsSync(c.boveda) ? core.cargarBoveda(c.boveda) : [];
  if (notas.length > 0) grafo = core.unirGrafos(grafo, core.grafoDeBoveda(notas));
  return { grafo, notas };
}

let ventana: BrowserWindow | undefined;

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#000000',
    title: 'Hilo',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 14 } } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) void ventana.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void ventana.loadFile(join(__dirname, '../renderer/index.html'));
}

const enviar = (canal: string, datos: unknown) => ventana?.webContents.send(canal, datos);

// ---------- Orquestador y subagentes ----------

interface PedidoAgentes {
  objetivo: string;
  rol: core.RolId;
  hiloId?: string;
}

async function orquestar(p: PedidoAgentes): Promise<void> {
  const perfil = perfilActual();
  const cfg = leerConfig();
  const { grafo, notas } = cargarTodo();
  const raiz = raizDatos();
  const cwd = cfg.proyecto && existsSync(cfg.proyecto) ? cfg.proyecto : (cfg.boveda ?? raiz);
  const soloLectura = !cfg.permitirEditar;
  const hilo = p.hiloId ? core.cargarHilo(raiz, p.hiloId) : undefined;
  const recuerdo = hilo ? core.recordatorio(hilo) : `# Hilo nuevo — rol ${p.rol}\nObjetivo: ${p.objetivo}`;

  const contextoPara = (consulta: string, rol: core.RolId, presupuesto: number) => {
    const paquete = core.paqueteDeContexto(grafo, { alcance: { tipo: 'todo' }, rol, conciso: true, sinRuido: true, presupuesto, consulta });
    const extra = core
      .buscarNotas(notas, consulta, 3)
      .map((x) => `\n## ${x.nota.titulo} (${x.nota.ruta})\n${core.extractoRelevante(x.nota.texto, consulta, 1000)}`)
      .join('\n');
    return paquete.texto + extra;
  };

  enviar('agente:evento', { fase: 'orquestador', estado: 'inicio', texto: 'Planificando…' });
  const plan = await core.ejecutar({
    asignado: perfil.modelos.orquestador,
    sistema: 'Eres el orquestador. Solo planificas. No inventes datos; si falta información, crea una subtarea que la pida.',
    prompt: `${recuerdo}\n\n${core.resumenEstatico(grafo, { porComunidad: 2, maxComunidades: 10 })}\n${contextoPara(p.objetivo, 'integrador', 700)}\n\n${core.promptOrquestador(p.objetivo, '')}`,
    cwd,
    soloLectura: true,
  });
  const subtareas = core.leerSubtareas(plan.texto);
  enviar('agente:evento', { fase: 'orquestador', estado: 'fin', texto: plan.texto, subtareas: subtareas.length, ms: plan.duracionMs });
  if (subtareas.length === 0) {
    enviar('agente:evento', { fase: 'fin', estado: 'error', texto: 'El orquestador no devolvió subtareas válidas.' });
    return;
  }

  await core.correrSubagentes(subtareas, 2, async (s) => {
    const asignado = core.modeloDeRol(perfil, s.rol);
    enviar('agente:evento', { fase: 'subagente', rol: s.rol, estado: 'inicio', texto: s.instruccion, modelo: `${asignado.modelo} · ${asignado.esfuerzo}` });
    const r = await core.ejecutar({
      asignado,
      sistema: core.promptDeRol(s.rol, perfil, s.rol === 'desarrollador' || s.rol === 'tester' ? 'breve' : 'normal'),
      prompt: `${recuerdo}\n\n${contextoPara(s.consulta, s.rol, 1500)}\n\n## Tarea\n${s.instruccion}`,
      cwd,
      soloLectura: soloLectura || s.rol !== 'desarrollador',
    });
    enviar('agente:evento', { fase: 'subagente', rol: s.rol, estado: r.codigoSalida === 0 ? 'fin' : 'error', texto: r.texto, ms: r.duracionMs });
  });
  enviar('agente:evento', { fase: 'fin', estado: 'fin', texto: 'Listo. Revisa los borradores antes de publicar nada.' });
}

// ---------- IPC ----------

function registrarIpc(): void {
  ipcMain.handle('config:get', () => leerConfig());
  ipcMain.handle('config:set', (_e, c: Config) => guardarConfig({ ...leerConfig(), ...c }));
  ipcMain.handle('perfil:get', () => perfilActual());
  ipcMain.handle('dialogo:abrir', async (_e, tipo: 'archivo' | 'carpeta') => {
    const r = await dialog.showOpenDialog(ventana!, { properties: [tipo === 'carpeta' ? 'openDirectory' : 'openFile'] });
    return r.canceled ? undefined : r.filePaths[0];
  });
  ipcMain.handle('grafo:cargar', () => {
    const { grafo, notas } = cargarTodo();
    return { grafo, notas: notas.length };
  });
  ipcMain.handle('nota:leer', (_e, ruta: string) => {
    const c = leerConfig();
    if (!c.boveda) return undefined;
    const abs = resolve(c.boveda, ruta);
    if (!abs.startsWith(resolve(c.boveda))) return undefined;
    return existsSync(abs) ? readFileSync(abs, 'utf8') : undefined;
  });
  ipcMain.handle('notas:lista', () => cargarTodo().notas.map((n) => ({ ruta: n.ruta, titulo: n.titulo, carpeta: n.carpeta })));
  ipcMain.handle('sesion:estado', async () => ({ claude: await core.estadoSesion('claude'), codex: await core.estadoSesion('codex') }));
  ipcMain.handle('sesion:iniciar', async (_e, cli: core.CliId) => {
    if (!core.buscar(cli)) throw new Error(core.mensajeFaltante(cli));
    try {
      await core.iniciarSesion(cli);
    } catch (e) {
      throw new Error(core.errorLegible(e, cli));
    }
    return core.estadoSesion(cli);
  });
  ipcMain.handle('pr:revisar', async (_e, numero: string) => {
    const gh = await github();
    if (!gh) throw new Error('Conecta GitHub en Ajustes para revisar un PR.');
    return core.informe(await gh.api.cambioDePr(repoActivo(), numero), perfilActual());
  });
  ipcMain.handle('hilos:lista', () => core.listarHilos(raizDatos()));
  ipcMain.handle('hilos:guardar', (_e, h: core.Hilo) => {
    core.guardarHilo(raizDatos(), { ...h, actualizado: new Date().toISOString() });
    return core.listarHilos(raizDatos());
  });
  ipcMain.handle('contexto:paquete', (_e, o: Omit<core.OpcionesContexto, 'presupuesto'> & { presupuesto?: number }) => {
    const { grafo } = cargarTodo();
    const paquete = core.paqueteDeContexto(grafo, { presupuesto: 2000, ...o });
    return { ...paquete, ...core.medirAhorro(grafo, paquete) };
  });
  ipcMain.handle('contexto:resumen', () => {
    const { grafo } = cargarTodo();
    const texto = core.resumenEstatico(grafo);
    return { texto, ...core.medirAhorro(grafo, { tokens: core.estimarTokens(texto) }) };
  });
  ipcMain.handle('contexto:sesion-nueva', (_e, hiloId?: string) => {
    const { grafo } = cargarTodo();
    const perfil = perfilActual();
    const hilo = hiloId ? core.cargarHilo(raizDatos(), hiloId) : undefined;
    const texto = core.sesionNueva(hilo, core.resumenEstatico(grafo), core.promptDeRol(leerConfig().rol ?? 'desarrollador', perfil, 'breve'));
    return { texto, tokens: core.estimarTokens(texto) };
  });
  ipcMain.handle('portapapeles:copiar', (_e, t: string) => clipboard.writeText(t));
  ipcMain.handle('agentes:orquestar', (_e, p: PedidoAgentes) => {
    void orquestar(p).catch((err: unknown) => enviar('agente:evento', { fase: 'fin', estado: 'error', texto: String(err) }));
  });
}


// ---------- ClickUp, GitHub, plan y cola ----------

const ejecutarArchivo = promisify(execFile);

// ---------- GitHub por API ----------

let apiGithub: { token: string; api: core.GitHubApi } | undefined;

async function tokenGithub(): Promise<{ token: string; origen: 'guardado' | 'gh' } | undefined> {
  const c = leerConfig();
  if (c.githubToken && safeStorage.isEncryptionAvailable()) {
    try {
      return { token: safeStorage.decryptString(Buffer.from(c.githubToken, 'base64')), origen: 'guardado' };
    } catch {
      /* el llavero cambió: se intenta con gh */
    }
  }
  if (core.buscar('gh')) {
    try {
      const { stdout } = await ejecutarArchivo('gh', ['auth', 'token'], { timeout: 10_000 });
      if (stdout.trim()) return { token: stdout.trim(), origen: 'gh' };
    } catch {
      /* gh sin sesión */
    }
  }
  return undefined;
}

async function github(): Promise<{ api: core.GitHubApi; origen: 'guardado' | 'gh' } | undefined> {
  const t = await tokenGithub();
  if (!t) return undefined;
  if (apiGithub?.token !== t.token) apiGithub = { token: t.token, api: new core.GitHubApi(t.token) };
  return { api: apiGithub.api, origen: t.origen };
}


function clickup(): core.ClickUp | undefined {
  const c = leerConfig();
  if (!c.clickupToken || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return new core.ClickUp(safeStorage.decryptString(Buffer.from(c.clickupToken, 'base64')));
  } catch {
    return undefined;
  }
}

/** Nada llega a otras personas sin que alguien lo vea y lo confirme en un cuadro nativo. */
async function confirmarPublicacion(destino: string, texto: string): Promise<boolean> {
  const r = await dialog.showMessageBox(ventana!, {
    type: 'question',
    buttons: ['Publicar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    title: 'Publicar',
    message: `Se va a publicar en ${destino}`,
    detail: texto.length > 1500 ? `${texto.slice(0, 1500)}\n[…]` : texto,
  });
  return r.response === 0;
}

function registrarIpcExtra(): void {
  ipcMain.handle('clickup:token', async (_e, token: string) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El sistema no tiene llavero disponible para cifrar el token.');
    const quien = await new core.ClickUp(token.trim()).yo();
    guardarConfig({ ...leerConfig(), clickupToken: safeStorage.encryptString(token.trim()).toString('base64') });
    return quien;
  });
  ipcMain.handle('clickup:borrar', () => {
    const { clickupToken: _quitado, ...resto } = leerConfig();
    guardarConfig(resto);
  });
  ipcMain.handle('clickup:estado', async () => {
    const c = clickup();
    if (!c) return { conectado: false };
    try {
      return { conectado: true, usuario: (await c.yo()).usuario };
    } catch (e) {
      return { conectado: false, error: String(e) };
    }
  });
  ipcMain.handle('plan:generar', async (_e, o: { dias: number; capacidad: number }) => {
    const c = clickup();
    if (!c) throw new Error('Conecta ClickUp en Ajustes para armar el plan con las tareas reales.');
    const perfil = perfilActual();
    const listas = Object.values(perfil.clickup.listas).filter((id) => id !== perfil.clickup.listas.bugs);
    const tareas = (await Promise.all(listas.map((id) => c.tareasDeLista(id)))).flat();
    const plan = core.planificar(core.tareasAPlan(tareas), o.dias, o.capacidad, perfil.limites.lineasPorPr);
    return { plan, desbordes: core.desbordes(plan, o.capacidad), tareas: tareas.length };
  });
  ipcMain.handle('cola:cargar', async () => {
    const perfil = perfilActual();
    const gh = await github();
    if (!gh) throw new Error('Conecta GitHub en Ajustes para ver la cola.');
    const cola = await gh.api.cola(repoActivo(), perfil.integradores);
    return { cola, asignaciones: core.asignar(cola, perfil.integradores), metricas: core.estadistica(cola, perfil.integradores), integradores: perfil.integradores };
  });
  ipcMain.handle('publicar:github', async (_e, p: { numero: string; texto: string }) => {
    const perfil = perfilActual();
    const gh = await github();
    if (!gh) throw new Error('Conecta GitHub en Ajustes para publicar.');
    const repo = repoActivo();
    const veredicto = core.decidir({ tipo: 'comentar', rol: leerConfig().rol ?? 'integrador', objetivo: `PR ${p.numero}`, afirmaciones: [], humanoAprobo: true }, perfil, []);
    if (veredicto.veredicto === 'bloquear') throw new Error(veredicto.razones.join(' '));
    if (!(await confirmarPublicacion(`el PR #${p.numero} de ${repo}`, p.texto))) return { publicado: false };
    return { publicado: true, enlace: await gh.api.comentar(repo, p.numero, p.texto) };
  });
  ipcMain.handle('publicar:clickup', async (_e, p: { tareaId: string; texto: string }) => {
    const c = clickup();
    if (!c) throw new Error('Conecta ClickUp en Ajustes.');
    if (!(await confirmarPublicacion(`la tarea ${p.tareaId} de ClickUp`, p.texto))) return { publicado: false };
    return { publicado: true, id: await c.comentar(p.tareaId, p.texto) };
  });
}


// ---------- Diagnóstico ----------

interface Prueba {
  grupo: string;
  nombre: string;
  estado: 'ok' | 'aviso' | 'error';
  detalle: string;
  ayuda?: string;
}

async function diagnosticar(): Promise<Prueba[]> {
  const r: Prueba[] = [];
  const ok = (grupo: string, nombre: string, detalle: string) => r.push({ grupo, nombre, estado: 'ok', detalle });
  const mal = (grupo: string, nombre: string, detalle: string, ayuda?: string, estado: 'aviso' | 'error' = 'error') => r.push({ grupo, nombre, estado, detalle, ...(ayuda ? { ayuda } : {}) });

  for (const h of ['git', 'gh', 'claude', 'codex'] as const) {
    const ruta = core.buscar(h);
    const opcional = h === 'gh' || h === 'codex';
    if (ruta) ok('Herramientas', core.AYUDA_INSTALACION[h].nombre, ruta);
    else mal('Herramientas', core.AYUDA_INSTALACION[h].nombre, 'No se encuentra en el PATH de la app.', core.mensajeFaltante(h), opcional ? 'aviso' : 'error');
  }
  ok('Sistema', 'PATH de la app', `${(process.env.PATH ?? '').split(':').length} carpetas`);
  if (safeStorage.isEncryptionAvailable()) ok('Sistema', 'Llavero para cifrar tokens', 'disponible');
  else mal('Sistema', 'Llavero para cifrar tokens', 'No disponible: no se pueden guardar tokens.');
  if (Notification.isSupported()) ok('Sistema', 'Notificaciones', 'disponibles');
  else mal('Sistema', 'Notificaciones', 'No disponibles en este sistema.', undefined, 'aviso');

  for (const cli of ['claude', 'codex'] as const) {
    const s = await core.estadoSesion(cli);
    if (s.conectado) ok('Suscripciones', cli === 'claude' ? 'Claude Code' : 'Codex', s.detalle);
    else mal('Suscripciones', cli === 'claude' ? 'Claude Code' : 'Codex', s.detalle, s.instalado ? 'Inicia sesión desde Ajustes, Suscripciones.' : core.mensajeFaltante(cli), cli === 'codex' || !s.instalado ? 'aviso' : 'error');
  }

  const gh = await github();
  if (!gh) mal('GitHub', 'Cuenta', 'Sin conectar.', 'Usa Conectar GitHub (necesita gh) o pega un token personal.');
  else {
    try {
      const u = await gh.api.yo();
      ok('GitHub', 'Cuenta', `${u.login} · token ${gh.origen === 'gh' ? 'de gh' : 'pegado'}`);
      const repo = repoActivo();
      if (await gh.api.repoValido(repo)) {
        ok('GitHub', `Acceso a ${repo}`, 'lectura correcta');
        const prs = await gh.api.prsAbiertos(repo, u.login);
        ok('GitHub', 'PR abiertos', `${prs.length} leídos con su CI y revisiones`);
      } else mal('GitHub', `Acceso a ${repo}`, 'No se puede abrir.', 'Revisa el nombre y que tu cuenta tenga acceso (y SSO si la organización lo exige).');
      const l = await gh.api.limite();
      ok('GitHub', 'Cupo de peticiones', `${l.restante} de ${l.total} por hora`);
    } catch (e) {
      mal('GitHub', 'Conexión', core.errorLegible(e));
    }
  }

  const cu = clickup();
  if (!cu) mal('ClickUp', 'Cuenta', 'Sin conectar.', 'Pega tu token personal en Ajustes, Conexiones.');
  else {
    try {
      const q = await cu.yo();
      ok('ClickUp', 'Cuenta', q.usuario);
      const perfil = perfilActual();
      const listas = leerConfig().listasClickup?.length ? leerConfig().listasClickup! : Object.values(perfil.clickup.listas);
      let total = 0;
      for (const l of listas.slice(0, 3)) total += (await cu.tareasDeLista(l)).length;
      ok('ClickUp', 'Listas seguidas', `${listas.length} listas · ${total} tareas leídas en las primeras ${Math.min(3, listas.length)}`);
    } catch (e) {
      mal('ClickUp', 'Conexión', core.errorLegible(e));
    }
  }
  return r;
}

// ---------- Identidad, Mi día, avisos e instalaciones ----------

const normalizarRepo = (t: string): string => t.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
const repoActivo = (): string => {
  const c = leerConfig();
  const p = perfilActual();
  return c.repo ?? c.repos?.[0] ?? `${p.repo.owner}/${p.repo.name}`;
};

async function calcularMiDia(): Promise<{ dia: core.MiDia; avisosDeConexion: string[] }> {
  const perfil = perfilActual();
  const repo = repoActivo();
  const avisosDeConexion: string[] = [];
  const gh = await github();
  let yo: core.Identidad = {};
  if (gh) {
    try {
      yo = { github: (await gh.api.yo()).login };
    } catch (e) {
      avisosDeConexion.push(`GitHub: ${core.errorLegible(e)}`);
    }
  } else avisosDeConexion.push('GitHub no está conectado.');
  const cu = clickup();
  let tareas: core.TareaClickup[] = [];
  if (cu) {
    try {
      const quien = await cu.yo();
      yo = { ...yo, clickupId: quien.id, clickupUsuario: quien.usuario };
      const listas = leerConfig().listasClickup?.length ? leerConfig().listasClickup! : Object.values(perfil.clickup.listas);
      tareas = (await Promise.all(listas.map((l) => cu.tareasDeLista(l)))).flat();
    } catch (e) {
      avisosDeConexion.push(`ClickUp: ${core.errorLegible(e)}`);
    }
  } else avisosDeConexion.push('ClickUp no está conectado.');
  let prs: core.PrResumen[] = [];
  if (gh && yo.github) {
    try {
      prs = await gh.api.prsAbiertos(repo, yo.github);
      for (const p of prs.filter((x) => x.autor === yo.github).slice(0, 6)) {
        try {
          p.erroresDeFormato = core.informe(await gh.api.cambioDePr(repo, p.numero), perfil).errores.length;
        } catch {
          /* sin permiso para leer ese PR: se omite su formato */
        }
      }
    } catch (e) {
      avisosDeConexion.push(`GitHub (${repo}): ${core.errorLegible(e)}`);
    }
  }
  return { dia: core.miDia(tareas, prs, yo, perfil, new Date(), leerConfig().rol), avisosDeConexion };
}

let vistas = new Set<string>();
async function vigilar(): Promise<void> {
  if (!leerConfig().avisos) return;
  try {
    const { dia } = await calcularMiDia();
    const actuales = new Set(dia.acciones.map((a) => `${a.tipo}:${a.ref}`));
    const nuevas = dia.acciones.filter((a) => !vistas.has(`${a.tipo}:${a.ref}`) && a.prioridad <= 3);
    if (vistas.size > 0 && nuevas.length > 0 && Notification.isSupported()) {
      new Notification({ title: 'Hilo', body: nuevas.length === 1 ? nuevas[0]!.texto : `${nuevas.length} cosas nuevas por hacer. La primera: ${nuevas[0]!.texto}` }).show();
    }
    vistas = actuales;
  } catch {
    /* sin red o sin sesión: se reintenta en el siguiente ciclo */
  }
}

function registrarIpcConexiones(): void {
  ipcMain.handle('conexion:estado', async () => {
    const c = leerConfig();
    const gh = await github();
    let github_: { conectado: boolean; login?: string; nombre?: string; origen?: string; error?: string } = { conectado: false };
    if (gh) {
      try {
        const u = await gh.api.yo();
        github_ = { conectado: true, login: u.login, nombre: u.nombre, origen: gh.origen === 'gh' ? 'gh' : 'token' };
      } catch (e) {
        github_ = { conectado: false, error: core.errorLegible(e) };
      }
    }
    const cu = clickup();
    let clickupEstado: { conectado: boolean; usuario?: string; error?: string } = { conectado: false };
    if (cu) {
      try {
        clickupEstado = { conectado: true, usuario: (await cu.yo()).usuario };
      } catch (e) {
        clickupEstado = { conectado: false, error: core.errorLegible(e) };
      }
    }
    return { github: { ...github_, ghInstalado: Boolean(core.buscar('gh')) }, clickup: clickupEstado, repos: c.repos ?? [], repo: repoActivo(), avisos: Boolean(c.avisos), rol: c.rol };
  });
  ipcMain.handle('github:conectar', () =>
    new Promise<{ login?: string }>((resolver, rechazar) => {
      const ruta = core.buscar('gh');
      if (!ruta) return rechazar(new Error(`${core.mensajeFaltante('gh')} También puedes pegar un token personal de GitHub abajo.`));
      const p = spawn(ruta, ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let enviado = false;
      const leer = (d: Buffer) => {
        const t = d.toString('utf8');
        const codigo = /one-time code: ([A-Z0-9-]+)/i.exec(t)?.[1];
        if (codigo) enviar('conexion:codigo', { codigo, url: 'https://github.com/login/device' });
        if (!enviado && /Press Enter/i.test(t)) {
          enviado = true;
          p.stdin.write('\n');
        }
      };
      p.stdout.on('data', leer);
      p.stderr.on('data', leer);
      p.on('error', (e) => rechazar(new Error(core.errorLegible(e, 'gh'))));
      p.on('close', async (c) => {
        if (c !== 0) return rechazar(new Error('No se completó el inicio de sesión de GitHub.'));
        apiGithub = undefined;
        resolver({ login: (await (await github())?.api.yo())?.login });
      });
    }),
  );
  ipcMain.handle('github:token', async (_e, token: string) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El sistema no tiene llavero disponible para cifrar el token.');
    const quien = await new core.GitHubApi(token.trim()).yo();
    guardarConfig({ ...leerConfig(), githubToken: safeStorage.encryptString(token.trim()).toString('base64') });
    apiGithub = undefined;
    return quien;
  });
  ipcMain.handle('github:borrar-token', () => {
    const { githubToken: _quitado, ...resto } = leerConfig();
    guardarConfig(resto);
    apiGithub = undefined;
  });
  ipcMain.handle('repos:agregar', async (_e, texto: string) => {
    const repo = normalizarRepo(texto);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Escribe el repositorio como dueño/nombre o pega su dirección de GitHub.');
    const gh = await github();
    if (!gh) throw new Error('Conecta GitHub primero.');
    if (!(await gh.api.repoValido(repo))) throw new Error(`No pude abrir ${repo}. Revisa el nombre y que tu cuenta de GitHub tenga acceso.`);
    const c = leerConfig();
    return guardarConfig({ ...c, repos: [...new Set([...(c.repos ?? []), repo])], repo }).repos;
  });
  ipcMain.handle('repos:elegir', (_e, repo: string) => void guardarConfig({ ...leerConfig(), repo }));
  ipcMain.handle('repos:quitar', (_e, repo: string) => {
    const c = leerConfig();
    const repos = (c.repos ?? []).filter((r) => r !== repo);
    guardarConfig({ ...c, repos, repo: c.repo === repo ? repos[0] : c.repo });
    return repos;
  });
  ipcMain.handle('clickup:listas', async () => {
    const c = clickup();
    if (!c) throw new Error('Conecta ClickUp primero.');
    return { listas: await c.listas(), elegidas: leerConfig().listasClickup ?? [] };
  });
  ipcMain.handle('clickup:elegir-listas', (_e, ids: string[]) => void guardarConfig({ ...leerConfig(), listasClickup: ids }));
  ipcMain.handle('avisos:fijar', (_e, v: boolean) => void guardarConfig({ ...leerConfig(), avisos: v }));
  ipcMain.handle('rol:fijar', (_e, rol: core.RolId | undefined) => {
    const { rol: _viejo, ...resto } = leerConfig();
    guardarConfig(rol ? { ...resto, rol } : resto);
  });
  ipcMain.handle('midia:cargar', () => calcularMiDia());
  ipcMain.handle('diagnostico:correr', () => diagnosticar());
  ipcMain.handle('instalaciones:conteo', async () => {
    const repo = leerConfig().repoHilo ?? 'kisnner26/hilo';
    const gh = await github();
    const rel = gh ? await gh.api.releases(repo) : await core.publicoReleases(repo);
    return { repo, releases: rel.map((r) => ({ ...r, total: r.activos.reduce((n, a) => n + a.descargas, 0) })) };
  });
}

void app.whenReady().then(() => {
  registrarIpc();
  registrarIpcExtra();
  registrarIpcConexiones();
  setInterval(() => void vigilar(), 5 * 60_000);
  setTimeout(() => void vigilar(), 20_000);
  crearVentana();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && crearVentana());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
