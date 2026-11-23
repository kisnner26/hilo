import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as core from '@hilo/core';

interface Config {
  perfil?: string;
  grafo?: string;
  boveda?: string;
  raiz?: string;
  repo?: string;
  /** Modelo y esfuerzo por función; si falta una, se usa la del perfil. */
  modelos?: Partial<Record<keyof core.Perfil['modelos'], core.ModeloAsignado>>;
  /** Si es falso, los agentes solo leen y proponen. */
  permitirEditar?: boolean;
}

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
  let grafo: core.Grafo = c.grafo && existsSync(c.grafo) ? core.cargarGrafo(c.grafo) : { nodos: [], enlaces: [] };
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
  const cwd = cfg.boveda ?? raiz;
  const soloLectura = !cfg.permitirEditar;
  const hilo = p.hiloId ? core.cargarHilo(raiz, p.hiloId) : undefined;
  const recuerdo = hilo ? core.recordatorio(hilo) : `# Hilo nuevo — rol ${p.rol}\nObjetivo: ${p.objetivo}`;

  const contextoPara = (consulta: string, rol: core.RolId, presupuesto: number) => {
    const paquete = core.paqueteDeContexto(grafo, { alcance: { tipo: 'todo' }, rol, conciso: true, sinRuido: true, presupuesto, consulta });
    const extra = core
      .buscarNotas(notas, consulta, 3)
      .map((x) => `\n## ${x.nota.titulo} (${x.nota.ruta})\n${x.nota.texto.slice(0, 1000)}`)
      .join('\n');
    return paquete.texto + extra;
  };

  enviar('agente:evento', { fase: 'orquestador', estado: 'inicio', texto: 'Planificando…' });
  const plan = await core.ejecutar({
    asignado: perfil.modelos.orquestador,
    sistema: 'Eres el orquestador. Solo planificas. No inventes datos; si falta información, crea una subtarea que la pida.',
    prompt: `${recuerdo}\n\n${contextoPara(p.objetivo, 'integrador', 1200)}\n\n${core.promptOrquestador(p.objetivo, '')}`,
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
      sistema: core.promptDeRol(s.rol, perfil),
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
    await core.iniciarSesion(cli);
    return core.estadoSesion(cli);
  });
  ipcMain.handle('pr:revisar', (_e, numero: string) => {
    const perfil = perfilActual();
    const repo = leerConfig().repo ?? `${perfil.repo.owner}/${perfil.repo.name}`;
    return core.informe(core.cambioDePr(numero, repo), perfil);
  });
  ipcMain.handle('hilos:lista', () => core.listarHilos(raizDatos()));
  ipcMain.handle('hilos:guardar', (_e, h: core.Hilo) => {
    core.guardarHilo(raizDatos(), { ...h, actualizado: new Date().toISOString() });
    return core.listarHilos(raizDatos());
  });
  ipcMain.handle('contexto:paquete', (_e, o: Omit<core.OpcionesContexto, 'presupuesto'> & { presupuesto?: number }) => {
    const { grafo } = cargarTodo();
    return core.paqueteDeContexto(grafo, { presupuesto: 2000, ...o });
  });
  ipcMain.handle('portapapeles:copiar', (_e, t: string) => clipboard.writeText(t));
  ipcMain.handle('agentes:orquestar', (_e, p: PedidoAgentes) => {
    void orquestar(p).catch((err: unknown) => enviar('agente:evento', { fase: 'fin', estado: 'error', texto: String(err) }));
  });
}

void app.whenReady().then(() => {
  registrarIpc();
  crearVentana();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && crearVentana());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
