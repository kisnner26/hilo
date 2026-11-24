import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, Notification, safeStorage, shell } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as core from '@hilo/core';
import { registrarAutopiloto, registrarUso } from './autopiloto';

type TipoProgramada = 'avisos' | 'resumen-dia' | 'revisar-prs' | 'informe-cola' | 'autopiloto';
interface Programada {
  id: TipoProgramada;
  activo: boolean;
  /** Cada cuántos minutos (para las periódicas). */
  cadaMin?: number;
  /** Hora del día, HH:MM (para las diarias). */
  hora?: string;
  ultima?: string;
  resultado?: string;
}

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
  /** Ahorro de tokens: interruptor general, técnicas y topes. */
  ahorro?: Partial<core.AjustesAhorro>;
  /** Tareas programadas: avisos, resumen del día, revisión de PR e informe de cola. */
  programadas?: Programada[];
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
nativeTheme.themeSource = 'dark';
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
    title: 'Hilo',
    // Fondo propio y constante: el cristal lo dibuja la app. Así el tono no depende del escritorio ni cambia en pantalla completa.
    backgroundColor: '#070708',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) void ventana.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void ventana.loadFile(join(__dirname, '../renderer/index.html'), process.env.HILO_DEMO ? { query: { demo: '1', rol: 'integrador' } } : undefined);
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
  const ah = core.ahorroEfectivo(cfg.ahorro);
  const hilo = p.hiloId ? core.cargarHilo(raiz, p.hiloId) : undefined;
  const recuerdo = hilo ? core.recordatorio(hilo) : `# Hilo nuevo — rol ${p.rol}\nObjetivo: ${p.objetivo}`;

  const contextoPara = (consulta: string, rol: core.RolId, presupuesto: number) => {
    const paquete = core.paqueteDeContexto(grafo, { alcance: { tipo: 'todo' }, rol, conciso: true, sinRuido: true, presupuesto, consulta });
    const extra = core
      .buscarNotas(notas, consulta, 3)
      .map((x) => `\n## ${x.nota.titulo} (${x.nota.ruta})\n${ah.extractos ? core.extractoRelevante(x.nota.texto, consulta, ah.maxCaracteresNota) : x.nota.texto.slice(0, ah.maxCaracteresNota)}`)
      .join('\n');
    return paquete.texto + extra;
  };

  enviar('agente:evento', { fase: 'orquestador', estado: 'inicio', texto: 'Planificando…' });
  const plan = await core.ejecutar({
    asignado: perfil.modelos.orquestador,
    sistema: 'Eres el orquestador. Solo planificas. No inventes datos; si falta información, crea una subtarea que la pida.',
    prompt: `${recuerdo}\n\n${ah.resumen ? core.resumenEstatico(grafo, { porComunidad: 2, maxComunidades: 10 }) : ''}\n${contextoPara(p.objetivo, 'integrador', Math.round(ah.presupuesto / 2))}\n\n${core.promptOrquestador(p.objetivo, '')}`,
    cwd,
    soloLectura: true,
  });
  const subtareas = core.leerSubtareas(plan.texto).slice(0, ah.maxSubagentes);
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
      sistema: core.promptDeRol(s.rol, perfil, ah.estiloBreve && (s.rol === 'desarrollador' || s.rol === 'tester') ? 'breve' : 'normal'),
      prompt: `${recuerdo}\n\n${contextoPara(s.consulta, s.rol, ah.presupuesto)}\n\n## Tarea\n${s.instruccion}`,
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
  ipcMain.handle('notas:lista', () =>
    cargarTodo().notas.map((n) => ({
      ruta: n.ruta,
      titulo: n.titulo,
      carpeta: n.carpeta,
      resumen: (n.texto.split(/\n{2,}/).map((x) => x.replace(/^#+\s.*$/gm, '').trim()).find((x) => x.length > 30) ?? '').replace(/\s+/g, ' ').slice(0, 140),
      palabras: n.texto.split(/\s+/).length,
    })),
  );
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



// ---------- Chat libre ----------

interface Conversacion {
  sesion: string;
  creada: boolean;
}
const conversaciones = new Map<string, Conversacion>();
let diaCache: { hasta: number; dia: core.MiDia } | undefined;
let calculoCache: { hasta: number; r: Awaited<ReturnType<typeof calcularMiDia>> } | undefined;

async function diaCacheado(forzar = false): Promise<core.MiDia> {
  if (!forzar && diaCache && diaCache.hasta > Date.now()) return diaCache.dia;
  const { dia } = await calcularMiDia();
  diaCache = { hasta: Date.now() + 90_000, dia };
  return dia;
}

interface PedidoChat {
  conv: string;
  texto?: string;
  tarea?: { accion: core.AccionTarea; ref: string };
}

async function turnoDeChat(p: PedidoChat): Promise<void> {
  const emitir = (e: Record<string, unknown>) => enviar('chat:evento', { conv: p.conv, ...e });
  try {
    const perfil = perfilActual();
    const cfg = leerConfig();
    const ah = core.ahorroEfectivo(cfg.ahorro);
    const repo = repoActivo();
    const dia = await diaCacheado(!conversaciones.has(p.conv));

    // Lo que se contesta con datos que ya tenemos no gasta tokens.
    if (!p.tarea && p.texto && ah.respuestasInmediatas) {
      const intencion = core.detectarIntencion(p.texto);
      if (intencion) {
        emitir({ tipo: 'respuesta', ...core.respuestaDeIntencion(intencion, dia) });
        return;
      }
    }

    const evitadosChat: core.Evitado[] = [];
    let conv = conversaciones.get(p.conv);
    if (!conv) {
      conv = { sesion: randomUUID(), creada: false };
      conversaciones.set(p.conv, conv);
    }
    const { grafo, notas } = cargarTodo();
    let prompt = p.texto ?? '';
    if (p.tarea) {
      const { accion } = p.tarea;
      const numero = /^\d+$/.test(p.tarea.ref) ? Number(p.tarea.ref) : undefined;
      const prPorNumero = numero !== undefined ? dia.prs.find((x) => x.numero === numero) : undefined;
      // Si el botón viene de un PR, la tarea es la del código del título: "[INT-02] ..." es INT-02.
      const ref = prPorNumero ? (core.codigoDeTitulo(prPorNumero.titulo) ?? p.tarea.ref) : p.tarea.ref;
      const tarea = dia.tareas.find((t) => t.codigo === ref);
      const pr = prPorNumero ?? dia.prs.find((x) => new RegExp(`^\\[${ref}\\]`).test(x.titulo));
      const cu = clickup();
      const detalle = tarea && cu ? await cu.detalleTarea(tarea.id).catch(() => undefined) : undefined;
      let informe: string | undefined;
      let diff: string | undefined;
      if (accion === 'revisar' && pr) {
        const gh = await github();
        if (gh) {
          informe = core.formatearInforme(core.informe(await gh.api.cambioDePr(repo, pr.numero), perfil));
          const crudo = await gh.api.diff(repo, pr.numero, ah.maxLineasDiff).catch(() => undefined);
          diff = crudo && ah.comprimirLogs ? core.comprimirSalida(crudo, ah.maxLineasDiff) : crudo;
          if (crudo && diff && ah.comprimirLogs) evitadosChat.push(core.evitado('diff', crudo, diff));
        }
      }
      prompt = core.promptTarea(accion, ref, detalle, pr, informe, diff);
    } else if (notas.length > 0 && p.texto) {
      const extra = core.buscarNotas(notas, p.texto, ah.alcance ? 2 : 4).map((x) => `## ${x.nota.titulo}\n${ah.extractos ? core.extractoRelevante(x.nota.texto, p.texto!, ah.maxCaracteresNota) : x.nota.texto.slice(0, ah.maxCaracteresNota)}`).join('\n\n');
      if (extra) prompt = `${p.texto}\n\n[Notas del proyecto que pueden ayudar]\n${extra}`;
    }

    const contextoBase = ah.resumen ? core.resumenEstatico(grafo, { porComunidad: 2, maxComunidades: 10 }) : core.paqueteDeContexto(grafo, { alcance: { tipo: 'todo' }, rol: dia.rol, conciso: true, sinRuido: true, presupuesto: ah.presupuesto }).texto;
    const sistema = core.promptSistemaChat(perfil, dia, contextoBase, repo, ah.estiloBreve ? 'breve' : 'normal');
    const asignado = perfil.modelos.asistente;
    const cwd = cfg.proyecto && existsSync(cfg.proyecto) ? cfg.proyecto : (cfg.boveda ?? raizDatos());
    emitir({ tipo: 'inicio', modelo: `${asignado.modelo} · ${asignado.esfuerzo}` });
    const r = await core.ejecutar({
      asignado,
      sistema: asignado.cli === 'claude' ? sistema : undefined,
      prompt: asignado.cli === 'claude' ? prompt : `${sistema}\n\n${prompt}`,
      cwd,
      soloLectura: true,
      ...(asignado.cli === 'claude' ? { sesion: ah.sesionContinua ? { id: conv.sesion, reanudar: conv.creada } : { id: randomUUID(), reanudar: false } } : {}),
      alTexto: (delta) => emitir({ tipo: 'delta', texto: delta }),
    });
    if (r.codigoSalida !== 0 && !r.texto) {
      conv.sesion = randomUUID();
      emitir({ tipo: 'error', texto: `El agente terminó con código ${r.codigoSalida}. Revisa en Ajustes que tu suscripción esté conectada.` });
      return;
    }
    conv.creada = true;
    registrarUso({ fecha: new Date().toISOString(), paso: p.tarea ? `chat-${p.tarea.accion}` : 'chat', ref: p.tarea?.ref ?? '-', modelo: `${asignado.modelo} · ${asignado.esfuerzo}`, ms: r.duracionMs, ...(r.uso ? { uso: r.uso } : {}), evitados: evitadosChat });
    emitir({ tipo: 'fin', texto: r.texto, ms: r.duracionMs });
  } catch (e) {
    emitir({ tipo: 'error', texto: core.errorLegible(e, 'claude') });
  }
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

async function calcularMiDia(): Promise<{ dia: core.MiDia; avisosDeConexion: string[]; bruto: { tareas: core.TareaClickup[]; prs: core.PrResumen[]; yo: core.Identidad } }> {
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
  return { dia: core.miDia(tareas, prs, yo, perfil, new Date(), leerConfig().rol), avisosDeConexion, bruto: { tareas, prs, yo } };
}

let vistas = new Set<string>();
async function ejecutarAvisos(): Promise<string> {
  try {
    const { dia } = await calcularMiDia();
    const actuales = new Set(dia.acciones.map((a) => `${a.tipo}:${a.ref}`));
    const nuevas = dia.acciones.filter((a) => !vistas.has(`${a.tipo}:${a.ref}`) && a.prioridad <= 3);
    const primera = vistas.size === 0;
    vistas = actuales;
    if (!primera && nuevas.length > 0) {
      avisar(nuevas.length === 1 ? nuevas[0]!.texto : `${nuevas.length} cosas nuevas por hacer. La primera: ${nuevas[0]!.texto}`);
      return `${nuevas.length} urgente${nuevas.length === 1 ? '' : 's'} nueva${nuevas.length === 1 ? '' : 's'}`;
    }
    return primera ? `Línea base tomada: ${actuales.size} pendientes` : 'Sin novedades';
  } catch (e) {
    return `No se pudo revisar: ${core.errorLegible(e)}`;
  }
}

function avisar(texto: string): void {
  if (Notification.isSupported()) new Notification({ title: 'Hilo', body: texto }).show();
}

// ---------- Revisión automática de PR (integradores) ----------

interface RevisionPr {
  numero: number;
  titulo: string;
  autor: string;
  url: string;
  ci: string;
  lineas: number;
  errores: number;
  avisos: number;
  sha?: string;
  hallazgos: { gravedad: 'ERROR' | 'AVISO'; regla: string; mensaje: string; arreglo?: string }[];
  comentario: string;
}
const cacheRevision = new Map<string, RevisionPr>();

async function esIntegrador(): Promise<boolean> {
  const cfg = leerConfig();
  if (cfg.rol) return cfg.rol === 'integrador';
  const gh = await github();
  if (!gh) return false;
  try {
    return perfilActual().integradores.includes((await gh.api.yo()).login);
  } catch {
    return false;
  }
}

/** Revisa de una vez el formato de todos los PR listos de otras personas. Lo ya revisado en el mismo commit sale de la caché. */
async function revisarCola(): Promise<RevisionPr[]> {
  const gh = await github();
  if (!gh) throw new Error('Conecta GitHub en Ajustes para revisar PR.');
  const perfil = perfilActual();
  const repo = repoActivo();
  const yo = await gh.api.yo();
  const prs = (await gh.api.prsAbiertos(repo, yo.login)).filter((p) => !p.borrador && p.autor !== yo.login);
  const salida: RevisionPr[] = [];
  await core.correrSubagentes(prs, 4, async (p) => {
    const clave = `${repo}#${p.numero}:${p.sha ?? ''}`;
    let r: RevisionPr | undefined = p.sha ? cacheRevision.get(clave) : undefined;
    if (!r) {
      const inf = core.informe(await gh.api.cambioDePr(repo, p.numero), perfil);
      r = {
        numero: p.numero,
        titulo: p.titulo,
        autor: p.autor,
        url: p.url,
        ci: p.ci,
        lineas: inf.lineas,
        errores: inf.errores.length,
        avisos: inf.avisos.length,
        ...(p.sha ? { sha: p.sha } : {}),
        hallazgos: [
          ...inf.errores.map((h) => ({ gravedad: 'ERROR' as const, regla: h.regla, mensaje: h.mensaje, ...(h.arreglo ? { arreglo: h.arreglo } : {}) })),
          ...inf.avisos.map((h) => ({ gravedad: 'AVISO' as const, regla: h.regla, mensaje: h.mensaje, ...(h.arreglo ? { arreglo: h.arreglo } : {}) })),
        ],
        comentario: core.comentarioDeRevision(p.numero, inf),
      };
      if (p.sha) cacheRevision.set(clave, r);
    }
    if (r) salida.push(r);
  });
  return salida.sort((a, b) => b.errores - a.errores || a.numero - b.numero);
}

// ---------- Tareas programadas ----------

const PROGRAMADAS_BASE: Programada[] = [
  { id: 'avisos', activo: false, cadaMin: 5 },
  { id: 'resumen-dia', activo: false, hora: '09:00' },
  { id: 'revisar-prs', activo: false, cadaMin: 15 },
  { id: 'informe-cola', activo: false, hora: '17:00' },
  { id: 'autopiloto', activo: false, hora: '08:30' },
];

function programadas(): Programada[] {
  const c = leerConfig();
  return PROGRAMADAS_BASE.map((d) => {
    const g = c.programadas?.find((x) => x.id === d.id);
    return { ...d, ...(g ?? {}), ...(d.id === 'avisos' && !g && c.avisos ? { activo: true } : {}) };
  });
}

let reportadosRevision = new Set<string>();
let prepararAutopiloto: () => Promise<string> = async () => 'No disponible';

async function ejecutarProgramada(p: Programada): Promise<string> {
  if (p.id === 'avisos') return ejecutarAvisos();
  if (p.id === 'autopiloto') return prepararAutopiloto();
  if (p.id === 'resumen-dia') {
    const { dia } = await calcularMiDia();
    const texto = `${dia.tareas.length} tarea${dia.tareas.length === 1 ? '' : 's'}, ${dia.prs.length} PR tuyo${dia.prs.length === 1 ? '' : 's'} y ${dia.acciones.filter((a) => a.prioridad <= 3).length} urgente(s).${dia.acciones[0] ? ` Primero: ${dia.acciones[0].texto}` : ''}`;
    avisar(`Tu día: ${texto}`);
    return texto;
  }
  if (p.id === 'revisar-prs') {
    if (!(await esIntegrador())) return 'Solo para integradores';
    const r = await revisarCola();
    const nuevos = r.filter((x) => x.errores > 0 && !reportadosRevision.has(`${x.numero}:${x.sha ?? ''}`));
    const primera = reportadosRevision.size === 0;
    for (const x of r) if (x.errores > 0) reportadosRevision.add(`${x.numero}:${x.sha ?? ''}`);
    if (!primera && nuevos.length > 0) avisar(`${nuevos.length} PR con errores de formato: ${nuevos.slice(0, 5).map((x) => `#${x.numero}`).join(', ')}. Ábrelos en Revisar PR.`);
    return `${r.length} PR revisados, ${r.filter((x) => x.errores > 0).length} con errores${!primera && nuevos.length ? ` (${nuevos.length} nuevos)` : ''}`;
  }
  const gh = await github();
  if (!gh) return 'GitHub sin conectar';
  const perfil = perfilActual();
  const cola = await gh.api.cola(repoActivo(), perfil.integradores);
  const m = core.estadistica(cola, perfil.integradores);
  const texto = `${m.prs} PR abiertos, ${m.conMasDeTresRondas.length} con más de 3 rondas, ${m.rondasPromedio.toFixed(1)} rondas en promedio`;
  avisar(`Cola de revisión: ${texto}`);
  return texto;
}

function vencida(p: Programada, ahora = new Date()): boolean {
  if (!p.activo) return false;
  const ultima = p.ultima ? new Date(p.ultima) : undefined;
  if (p.cadaMin) return !ultima || ahora.getTime() - ultima.getTime() >= p.cadaMin * 60_000;
  if (p.hora) {
    const [h, m] = p.hora.split(':').map(Number);
    const hoy = new Date(ahora);
    hoy.setHours(h ?? 0, m ?? 0, 0, 0);
    return ahora >= hoy && (!ultima || ultima < hoy);
  }
  return false;
}

function guardarEjecucion(id: TipoProgramada, resultado: string): void {
  const c = leerConfig();
  const lista = programadas().map((x) => (x.id === id ? { ...x, ultima: new Date().toISOString(), resultado } : x));
  guardarConfig({ ...c, programadas: lista });
}

let corriendoProgramadas = false;
async function tickProgramadas(): Promise<void> {
  if (corriendoProgramadas) return;
  corriendoProgramadas = true;
  try {
    for (const p of programadas().filter((x) => vencida(x))) {
      try {
        guardarEjecucion(p.id, await ejecutarProgramada(p));
      } catch (e) {
        guardarEjecucion(p.id, `Error: ${core.errorLegible(e)}`);
      }
    }
  } finally {
    corriendoProgramadas = false;
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
    const creador = Boolean(github_.login && github_.login.toLowerCase() === ((c.repoHilo ?? 'kisnner26/hilo').split('/')[0] ?? '').toLowerCase());
    return { github: { ...github_, ghInstalado: Boolean(core.buscar('gh')) }, clickup: clickupEstado, creador, repos: c.repos ?? [], repo: repoActivo(), avisos: Boolean(c.avisos), rol: c.rol };
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
  ipcMain.handle('revisar:cola', () => revisarCola());
  ipcMain.handle('programadas:lista', async () => ({ lista: programadas(), integrador: await esIntegrador() }));
  ipcMain.handle('programadas:guardar', (_e, lista: Programada[]) => {
    guardarConfig({ ...leerConfig(), programadas: lista });
    return programadas();
  });
  ipcMain.handle('programadas:ejecutar', async (_e, id: TipoProgramada) => {
    const p = programadas().find((x) => x.id === id);
    if (!p) throw new Error('Tarea desconocida.');
    const r = await ejecutarProgramada(p);
    guardarEjecucion(id, r);
    return r;
  });
  ipcMain.handle('chat:enviar', (_e, p: PedidoChat) => void turnoDeChat(p));
  ipcMain.handle('chat:nueva', (_e, conv: string) => {
    conversaciones.delete(conv);
    diaCache = undefined;
  });
  ipcMain.handle('diagnostico:correr', () => diagnosticar());
  ipcMain.handle('instalaciones:conteo', async () => {
    const repo = leerConfig().repoHilo ?? 'kisnner26/hilo';
    const gh = await github();
    // Solo el creador del proyecto ve las descargas.
    const yo = gh ? await gh.api.yo().catch(() => undefined) : undefined;
    if (!yo || yo.login.toLowerCase() !== (repo.split('/')[0] ?? '').toLowerCase()) throw new Error('Solo el creador del proyecto puede ver las descargas.');
    const rel = gh ? await gh.api.releases(repo) : await core.publicoReleases(repo);
    return { repo, releases: rel.map((r) => ({ ...r, total: r.activos.reduce((n, a) => n + a.descargas, 0) })) };
  });
}

void app.whenReady().then(() => {
  registrarIpc();
  registrarIpcExtra();
  registrarIpcConexiones();
  const auto = registrarAutopiloto({
    config: () => leerConfig(),
    perfil: perfilActual,
    repo: repoActivo,
    github,
    clickup,
    calcular: async (forzar) => {
      if (!forzar && calculoCache && calculoCache.hasta > Date.now()) return calculoCache.r;
      const r = await calcularMiDia();
      calculoCache = { hasta: Date.now() + 60_000, r };
      diaCache = { hasta: Date.now() + 90_000, dia: r.dia };
      return r;
    },
    enviar,
    confirmar: confirmarPublicacion,
    avisar,
    raizDatos,
  });
  prepararAutopiloto = auto.prepararSinTokens;
  setInterval(() => void tickProgramadas(), 60_000);
  setTimeout(() => void tickProgramadas(), 20_000);
  crearVentana();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && crearVentana());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
