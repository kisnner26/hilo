import { app, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@hilo/core';
import { asignadoParaAgente } from './motores';

/**
 * Autopiloto: prepara en lote todo lo que le toca a la persona y lo deja en una bandeja.
 * Hilo hace solo lo que no cuesta nada y no sale de la máquina; lo que llega a otras personas
 * (comentarios, ramas, PR) espera a que alguien lo apruebe.
 */

export interface DepsAuto {
  config(): { proyecto?: string; ahorro?: Partial<core.AjustesAhorro>; rol?: core.RolId };
  perfil(): core.Perfil;
  repo(): string;
  github(): Promise<{ api: core.GitHubApi } | undefined>;
  clickup(): core.ClickUp | undefined;
  calcular(forzar?: boolean): Promise<{ dia: core.MiDia; bruto: { tareas: core.TareaClickup[]; prs: core.PrResumen[]; yo: core.Identidad } }>;
  enviar(canal: string, datos: unknown): void;
  confirmar(destino: string, texto: string): Promise<boolean>;
  avisar(texto: string): void;
  raizDatos(): string;
  /** Qué IA se usa ahora. */
  motor(): Promise<{ id: core.MotorId; nombre: string; modelo?: string }>;
  generarLocal(m: { id: core.MotorId; nombre: string; modelo?: string }, p: core.PedidoLocal): Promise<string>;
}

export interface ItemBandeja {
  id: string;
  corrida: string;
  paso: core.PasoAuto;
  estado: 'listo' | 'publicado' | 'descartado' | 'error';
  texto: string;
  creado: string;
  modelo?: string;
  costoUsd?: number;
  detalle?: { idClickup?: string; resumen?: string; rama?: string; dir?: string; verificacion?: string; titulo?: string; cuerpo?: string; pendientesFormato?: number; archivos?: string[] };
  enlace?: string;
}

type Emitir = (e: Record<string, unknown>) => void;

const carpeta = () => {
  const d = join(app.getPath('userData'), 'autopiloto');
  mkdirSync(d, { recursive: true });
  return d;
};
const leer = <T>(nombre: string, vacio: T): T => {
  try {
    return JSON.parse(readFileSync(join(carpeta(), nombre), 'utf8')) as T;
  } catch {
    return vacio;
  }
};
const guardar = (nombre: string, datos: unknown) => writeFileSync(join(carpeta(), nombre), JSON.stringify(datos));

// ---------- Registro de uso (lo gastado de verdad y lo evitado) ----------

export function registrarUso(r: core.RegistroUso): void {
  const todos = leer<core.RegistroUso[]>('uso.json', []);
  todos.push(r);
  guardar('uso.json', todos.slice(-800));
}

// ---------- Bandeja ----------

let bandeja: ItemBandeja[] | undefined;
const items = (): ItemBandeja[] => (bandeja ??= leer<ItemBandeja[]>('bandeja.json', []));
const persistir = () => guardar('bandeja.json', items().slice(-200));
const cache = () => leer<Record<string, { texto: string; fecha: string }>>('pasos.json', {});

let corriendo: { id: string; control: AbortController } | undefined;

export function registrarAutopiloto(d: DepsAuto): { prepararSinTokens: () => Promise<string> } {
  const emitir = (e: Record<string, unknown>) => d.enviar('auto:evento', e);

  async function plan(opciones: core.OpcionesPlan = {}) {
    const { dia, bruto } = await d.calcular(true);
    const perfil = d.perfil();
    const bloqueos = core.analizarBloqueos(bruto.tareas, bruto.prs, bruto.yo, perfil);
    const todos = core.planAutopiloto(dia, bloqueos, perfil, opciones);
    // Editar código y arreglar el CI necesita un agente de suscripción; redactar puede hacerlo un modelo local.
    const m = await d.motor();
    const sirve = (x: core.PasoAuto) => x.ejecutor === 'hilo' || (core.esAgente(m.id) ? true : m.id !== 'reglas' && !x.escritura);
    const pasos = todos.filter(sirve);
    const omitidos = todos.filter((x) => !sirve(x)).map((x) => ({ id: x.id, titulo: x.titulo, motivo: x.escritura ? 'Editar código necesita Claude Code o Codex.' : 'Redactar necesita una IA: activa un modelo en Ajustes › Modelos.' }));
    return { dia, bruto, bloqueos, culpables: core.quienMeBloquea(bloqueos), pasos, omitidos, motor: m };
  }

  ipcMain.handle('auto:plan', async () => {
    const p = await plan();
    return { bloqueos: p.bloqueos, culpables: p.culpables, pasos: p.pasos, omitidos: p.omitidos, motor: p.motor.nombre, corriendo: corriendo?.id };
  });
  ipcMain.handle('auto:bandeja', () => items().slice(-60).reverse());
  ipcMain.handle('auto:cancelar', () => corriendo?.control.abort());
  ipcMain.handle('auto:descartar', (_e, ids: string[]) => {
    for (const i of items()) if (ids.includes(i.id) && i.estado === 'listo') i.estado = 'descartado';
    persistir();
  });
  ipcMain.handle('auto:correr', async (_e, ids?: string[]) => {
    if (corriendo) throw new Error('Ya hay una corrida en curso.');
    const p = await plan();
    const elegidos = core.ordenDeEjecucion(ids ? p.pasos.filter((x) => ids.includes(x.id)) : p.pasos);
    const control = new AbortController();
    const id = randomUUID();
    corriendo = { id, control };
    void correr(id, elegidos, p, control.signal).finally(() => {
      corriendo = undefined;
    });
    return { corrida: id, pasos: elegidos.length };
  });
  ipcMain.handle('auto:publicar', async (_e, ids: string[]) => publicar(ids));
  ipcMain.handle('uso:resumen', () => {
    const desde = Date.now() - 30 * 86_400_000;
    const todos = leer<core.RegistroUso[]>('uso.json', []).filter((r) => new Date(r.fecha).getTime() >= desde);
    return { ...core.resumirUso(todos), ultimos: todos.slice(-8).reverse().map((r) => ({ fecha: r.fecha, paso: r.paso, ref: r.ref, modelo: r.modelo, local: Boolean(r.local), tokens: (r.uso?.entrada ?? 0) + (r.uso?.cacheCreada ?? 0) + (r.uso?.salida ?? 0), costoUsd: r.uso?.costoUsd ?? 0 })) };
  });

  async function correr(corrida: string, pasos: core.PasoAuto[], p: Awaited<ReturnType<typeof plan>>, senal: AbortSignal): Promise<void> {
    const total = pasos.length;
    let listos = 0;
    emitir({ corrida, tipo: 'inicio', total });
    const uno = async (paso: core.PasoAuto) => {
      if (senal.aborted) {
        emitir({ corrida, tipo: 'paso', id: paso.id, estado: 'omitido', texto: 'Cancelado.' });
        return;
      }
      emitir({ corrida, tipo: 'paso', id: paso.id, estado: 'corriendo' });
      try {
        const item = await ejecutarPaso(corrida, paso, p, senal, (delta) => emitir({ corrida, tipo: 'delta', id: paso.id, texto: delta }));
        items().push(item);
        persistir();
        if (item.estado === 'listo') listos++;
        emitir({ corrida, tipo: 'paso', id: paso.id, estado: item.estado, item });
      } catch (e) {
        const texto = senal.aborted ? 'Cancelado.' : core.errorLegible(e, 'claude');
        const item: ItemBandeja = { id: randomUUID(), corrida, paso, estado: 'error', texto, creado: new Date().toISOString() };
        items().push(item);
        persistir();
        emitir({ corrida, tipo: 'paso', id: paso.id, estado: 'error', item });
      }
    };
    const libres = pasos.filter((x) => x.ejecutor === 'hilo');
    const ligeros = pasos.filter((x) => x.ejecutor === 'agente' && x.peso === 'ligero');
    const pesados = pasos.filter((x) => x.ejecutor === 'agente' && x.peso === 'completo');
    await core.correrSubagentes(libres, 4, uno);
    await core.correrSubagentes(ligeros, 2, uno);
    for (const x of pesados) await uno(x);
    emitir({ corrida, tipo: 'fin', listos, total });
    if (listos > 0) d.avisar(`Autopiloto: ${listos} cosa${listos === 1 ? '' : 's'} lista${listos === 1 ? '' : 's'} para aprobar.`);
  }

  async function ejecutarPaso(corrida: string, paso: core.PasoAuto, p: Awaited<ReturnType<typeof plan>>, senal: AbortSignal, alTexto: (t: string) => void): Promise<ItemBandeja> {
    const perfil = d.perfil();
    const cfg = d.config();
    const ah = core.ahorroEfectivo(cfg.ahorro);
    const repo = d.repo();
    const gh = await d.github();
    const inicio = Date.now();
    const base: ItemBandeja = { id: randomUUID(), corrida, paso, estado: 'listo', texto: '', creado: new Date().toISOString() };
    const pr = paso.pr ? p.bruto.prs.find((x) => x.numero === paso.pr) : undefined;
    const evitados: core.Evitado[] = [];
    const nota = (modelo: string, uso?: core.UsoAgente, local = false) => registrarUso({ fecha: base.creado, paso: paso.tipo, ref: paso.ref, modelo, ms: Date.now() - inicio, ...(uso ? { uso } : {}), evitados, ...(local ? { local: true } : {}) });

    // ---- Pasos que resuelve Hilo solo, sin modelo ----
    if (paso.ejecutor === 'hilo') {
      if (paso.tipo === 'actualizar-rama') {
        if (!gh || !pr) throw new Error('Conecta GitHub para actualizar la rama.');
        await gh.api.actualizarRama(repo, pr.numero, pr.sha);
        evitados.push({ tecnica: 'paso-local', antes: 350, despues: 0 });
        nota('-', undefined, true);
        return { ...base, estado: 'publicado', texto: `Rama del #${pr.numero} actualizada con ${perfil.repo.base}.` };
      }
      if (paso.tipo === 'revisar-pr') {
        if (!gh || !pr) throw new Error('Conecta GitHub para revisar.');
        const inf = core.informe(await gh.api.cambioDePr(repo, pr.numero), perfil);
        const texto = core.comentarioDeRevision(pr.numero, inf);
        evitados.push({ tecnica: 'paso-local', antes: core.estimarTokens(texto) + 1500, despues: 0 });
        nota('-', undefined, true);
        return { ...base, texto, detalle: { resumen: `${inf.errores.length} error(es), ${inf.avisos.length} aviso(s), ${inf.lineas} líneas` } };
      }
      evitados.push({ tecnica: 'paso-local', antes: core.estimarTokens(paso.texto ?? '') + 400, despues: 0 });
      nota('-', undefined, true);
      return { ...base, texto: paso.texto ?? '' };
    }

    // ---- Pasos con agente ----
    const cu = d.clickup();
    const tareaClick = paso.tarea ? p.dia.tareas.find((t) => t.codigo === paso.tarea) : undefined;
    const detalle = tareaClick && cu ? await cu.detalleTarea(tareaClick.id).catch(() => undefined) : undefined;
    const asignadoBase = core.modeloDelPaso(paso, perfil, ah);
    const tope = core.topeDelPaso(paso, ah);
    const cwdLectura = cfg.proyecto && existsSync(cfg.proyecto) ? cfg.proyecto : d.raizDatos();
    const sistema = core.promptDeRol(paso.escritura ? 'desarrollador' : 'documentador', perfil, ah.estiloBreve ? 'breve' : 'normal');
    const motorAhora = await d.motor();
    const asignado = asignadoParaAgente(motorAhora.id, asignadoBase);
    const correrAgente = async (prompt: string, cwd: string, escritura: boolean) => {
      if (core.esModeloLocal(motorAhora.id) && !escritura) {
        const t0 = Date.now();
        const texto = await d.generarLocal(motorAhora, { sistema: sistema, prompt, alTexto });
        evitados.push({ tecnica: 'modelo-local', antes: core.estimarTokens(sistema + prompt), despues: 0 });
        return { texto, codigoSalida: 0, duracionMs: Date.now() - t0, eventos: 0 } as core.Resultado;
      }
      return core.ejecutar({ asignado, sistema: asignado.cli === 'claude' ? sistema : undefined, prompt: asignado.cli === 'claude' ? prompt : `${sistema}\n\n${prompt}`, cwd, soloLectura: !escritura, escritura, ...(asignado.cli === 'claude' ? { presupuestoUsd: tope, sinSesion: true } : {}), senal, alTexto });
    };
    const modelo = core.esModeloLocal(motorAhora.id) && !paso.escritura ? motorAhora.nombre : `${asignado.modelo} · ${asignado.esfuerzo}`;

    if (!paso.escritura) {
      let ctx: core.ContextoPaso = { ...(detalle ? { tarea: detalle } : {}) };
      if (paso.tipo === 'corregir-formato') {
        if (!gh || !pr) throw new Error('Conecta GitHub para corregir el formato.');
        const cambio = await gh.api.cambioDePr(repo, pr.numero);
        ctx = { ...ctx, informe: core.formatearInforme(core.informe(cambio, perfil)), titulo: cambio.titulo, cuerpo: cambio.cuerpo };
      }
      const prompt = core.promptDelPaso(paso, ctx, perfil);
      const clave = core.claveDePaso(paso, pr?.sha, prompt);
      const guardado = ah.cachePasos ? cache()[clave] : undefined;
      let texto = guardado?.texto;
      let uso: core.UsoAgente | undefined;
      if (texto === undefined) {
        const r = await correrAgente(prompt, cwdLectura, false);
        if (r.codigoSalida !== 0 && !r.texto) throw new Error(`El agente terminó con código ${r.codigoSalida}.`);
        texto = r.texto;
        uso = r.uso;
        if (ah.cachePasos) guardar('pasos.json', { ...Object.fromEntries(Object.entries(cache()).slice(-150)), [clave]: { texto, fecha: base.creado } });
      } else evitados.push({ tecnica: 'cache-de-paso', antes: core.estimarTokens(prompt) + core.estimarTokens(texto), despues: 0 });
      nota(guardado ? '-' : modelo, uso, Boolean(guardado));
      if (paso.tipo === 'corregir-formato' && pr && gh) {
        const j = /\{[\s\S]*\}/.exec(texto)?.[0];
        const nuevo = j ? (JSON.parse(j) as { titulo?: string; cuerpo?: string }) : undefined;
        if (!nuevo?.titulo || !nuevo.cuerpo) throw new Error('El agente no devolvió título y cuerpo en el formato pedido.');
        const cambio = await gh.api.cambioDePr(repo, pr.numero);
        const despues = core.informe({ ...cambio, titulo: nuevo.titulo, cuerpo: nuevo.cuerpo }, perfil);
        return { ...base, modelo, texto: nuevo.cuerpo, ...(uso?.costoUsd !== undefined ? { costoUsd: uso.costoUsd } : {}), detalle: { titulo: nuevo.titulo, cuerpo: nuevo.cuerpo, pendientesFormato: despues.errores.length, resumen: despues.errores.length ? `Aún quedan ${despues.errores.length} error(es) de formato` : 'Sin errores de formato' } };
      }
      return { ...base, modelo, texto, ...(uso?.costoUsd !== undefined ? { costoUsd: uso.costoUsd } : {}) };
    }

    // ---- Pasos pesados: editar y probar en un espacio aislado ----
    if (!cfg.proyecto || !existsSync(cfg.proyecto)) throw new Error('Elige la carpeta del proyecto en Ajustes: ahí se crean los espacios de trabajo.');
    const login = p.bruto.yo.github;
    const rama = paso.tipo === 'iniciar-tarea' ? `feature/${(login ?? 'yo').toLowerCase()}-${paso.tarea}` : (pr?.rama ?? '');
    if (!rama) throw new Error('No se pudo saber la rama del PR.');
    const duras = core.validarRama({ rama, titulo: `[${paso.tarea}] x`, cuerpo: '', archivos: [] }, perfil).filter((h) => h.gravedad === 'error');
    if (duras.length > 0) throw new Error(`La rama ${rama} no cumple el formato del proyecto: ${duras[0]!.mensaje}`);
    emitir({ corrida, tipo: 'paso', id: paso.id, estado: 'corriendo', texto: `Preparando el espacio de ${rama}…` });
    const espacio = await core.crearEspacio(cfg.proyecto, rama, perfil.repo.base, join(d.raizDatos(), 'espacios'));

    const ctx: core.ContextoPaso = { rama, ...(detalle ? { tarea: detalle } : {}) };
    if (paso.tipo === 'arreglar-ci' && gh && pr?.sha) {
      const fallos = await gh.api.registrosFallidos(repo, pr.sha).catch(() => []);
      const crudo = fallos.map((f) => `# ${f.trabajo} / ${f.paso}\n${f.registro}`).join('\n');
      const digesto = fallos.map((f) => `# ${f.trabajo} / ${f.paso}\n${core.digestoDeRegistro(f.registro)}`).join('\n');
      evitados.push(core.evitado('registro-ci', crudo, digesto));
      ctx.digestoCi = digesto;
    }
    if (paso.tipo === 'aplicar-revision' && gh && pr) {
      const cs = await gh.api.comentariosDeRevision(repo, pr.numero);
      const compacto = core.compactarComentarios(cs);
      evitados.push(core.evitado('revision', JSON.stringify(cs), compacto));
      ctx.comentarios = compacto;
    }

    let r = await correrAgente(core.promptDelPaso(paso, ctx, perfil), espacio.dir, true);
    if (r.codigoSalida !== 0 && !r.texto) throw new Error(`El agente terminó con código ${r.codigoSalida}.`);
    let gastado = r.uso;
    let cambios = await core.cambiosDelEspacio(espacio);
    let verificacion = 'Sin archivos de código tocados: no hubo nada que comprobar.';
    for (let intento = 0; intento < 2; intento++) {
      const cmds = core.verificacionesPara(cambios.archivos, perfil.verificaciones);
      if (cmds.length === 0 || senal.aborted) break;
      emitir({ corrida, tipo: 'paso', id: paso.id, estado: 'corriendo', texto: `Comprobando: ${cmds.length} comando(s)…` });
      const v = await core.correrVerificaciones(espacio.dir, cmds);
      if (v.ok) {
        verificacion = `Pasó: ${cmds.join(' · ')}`;
        break;
      }
      const fallo = v.resultados.find((x) => !x.ok)!;
      verificacion = `Falló: ${fallo.comando}\n${fallo.salida}`;
      if (intento === 1) break;
      emitir({ corrida, tipo: 'paso', id: paso.id, estado: 'corriendo', texto: 'Falló una comprobación: se la devuelvo al agente, ya resumida.' });
      r = await correrAgente(`Falló esta comprobación:\n\n${fallo.comando}\n${fallo.salida}\n\nCorrige solo eso, vuelve a correrla y deja un commit.`, espacio.dir, true);
      gastado = gastado && r.uso ? { entrada: gastado.entrada + r.uso.entrada, salida: gastado.salida + r.uso.salida, cacheLeida: gastado.cacheLeida + r.uso.cacheLeida, cacheCreada: gastado.cacheCreada + r.uso.cacheCreada, costoUsd: (gastado.costoUsd ?? 0) + (r.uso.costoUsd ?? 0) } : (r.uso ?? gastado);
      cambios = await core.cambiosDelEspacio(espacio);
    }
    nota(modelo, gastado);
    return { ...base, modelo, texto: r.texto, ...(gastado?.costoUsd !== undefined ? { costoUsd: gastado.costoUsd } : {}), detalle: { resumen: cambios.resumen, rama, dir: espacio.dir, verificacion, archivos: cambios.archivos, ...(tareaClick ? { titulo: tareaClick.nombre.replace(/^[A-Z0-9-]+\s*[—–-]\s*/, ''), idClickup: tareaClick.id } : {}) } };
  }

  async function publicar(ids: string[]): Promise<{ publicados: number; errores: string[] }> {
    const elegidos = items().filter((i) => ids.includes(i.id) && i.estado === 'listo' && i.paso.salida !== 'ninguna');
    if (elegidos.length === 0) return { publicados: 0, errores: ['No hay nada listo para publicar en lo elegido.'] };
    const resumen = elegidos.map((i) => `• ${i.paso.titulo}\n  ${(i.detalle?.resumen ?? i.texto).replace(/\s+/g, ' ').slice(0, 160)}`).join('\n\n');
    if (!(await d.confirmar(`${elegidos.length} destino${elegidos.length === 1 ? '' : 's'} (GitHub y ClickUp)`, resumen))) return { publicados: 0, errores: [] };
    const gh = await d.github();
    const cu = d.clickup();
    const perfil = d.perfil();
    const repo = d.repo();
    const errores: string[] = [];
    let publicados = 0;
    for (const i of elegidos) {
      try {
        const s = i.paso.salida;
        if (s === 'comentario-github') {
          if (!gh) throw new Error('GitHub sin conectar.');
          const v = core.decidir({ tipo: 'comentar', rol: d.config().rol ?? 'integrador', objetivo: `PR ${i.paso.destino}`, afirmaciones: [], humanoAprobo: true }, perfil, []);
          if (v.veredicto === 'bloquear') throw new Error(v.razones.join(' '));
          i.enlace = await gh.api.comentar(repo, i.paso.destino!, i.texto);
        } else if (s === 'comentario-clickup') {
          if (!cu) throw new Error('ClickUp sin conectar.');
          await cu.comentar(i.paso.destino!, i.texto);
        } else if (s === 'editar-pr') {
          if (!gh || !i.detalle?.titulo) throw new Error('Falta GitHub o el texto nuevo.');
          i.enlace = await gh.api.editarPr(repo, i.paso.destino!, { title: i.detalle.titulo, body: i.detalle.cuerpo ?? '' });
        } else if (s === 'push' || s === 'rama-y-pr') {
          if (!i.detalle?.dir || !i.detalle.rama) throw new Error('No hay espacio de trabajo que subir.');
          const c = await core.cambiosDelEspacio({ dir: i.detalle.dir, base: perfil.repo.base });
          if (c.sinGuardar) throw new Error('Quedaron cambios sin guardar en un commit: revísalos antes de publicar.');
          if (c.commits === 0) throw new Error('No hay commits nuevos que subir.');
          await core.empujarRama(i.detalle.dir, i.detalle.rama);
          if (s === 'rama-y-pr') {
            if (!gh) throw new Error('GitHub sin conectar.');
            const duenoRepo = repo.split('/')[0];
            const dueno = d.config().proyecto ? await core.duenoDeOrigin(d.config().proyecto!) : undefined;
            const cuerpo = core.cuerpoDePr({ codigo: i.paso.tarea!, idClickup: i.detalle.idClickup ?? 'FALTA', modulo: 'FALTA', resumen: i.texto.split('\n')[0]?.slice(0, 200) ?? 'FALTA', rf: 'FALTA', casosDeUso: 'FALTA', contrato: 'FALTA', validaciones: [{ texto: i.detalle.verificacion?.startsWith('Pasó') ? i.detalle.verificacion : 'Verificaciones locales pendientes', hecha: Boolean(i.detalle.verificacion?.startsWith('Pasó')) }], pendientes: 'completar la trazabilidad antes de pedir revisión' });
            const nuevo = await gh.api.crearPrBorrador(repo, { titulo: `[${i.paso.tarea}] ${i.detalle.titulo ?? i.paso.tarea}`, cuerpo, cabeza: dueno && dueno !== duenoRepo ? `${dueno}:${i.detalle.rama}` : i.detalle.rama, base: perfil.repo.base });
            i.enlace = nuevo.url;
          }
        }
        i.estado = 'publicado';
        publicados++;
      } catch (e) {
        errores.push(`${i.paso.titulo}: ${core.errorLegible(e)}`);
      }
    }
    persistir();
    return { publicados, errores };
  }

  /** Lo que se puede dejar listo cada mañana sin gastar un solo token: ramas al día, avisos y entregas redactadas. */
  async function prepararSinTokens(): Promise<string> {
    const p = await plan();
    const libres = p.pasos.filter((x) => x.ejecutor === 'hilo');
    const nuevos = libres.filter((x) => !items().some((i) => i.paso.id === x.id && (i.estado === 'listo' || i.estado === 'publicado')));
    if (nuevos.length === 0) return 'Nada nuevo que preparar';
    const corrida = randomUUID();
    let hechos = 0;
    for (const paso of nuevos) {
      try {
        const item = await ejecutarPaso(corrida, paso, p, new AbortController().signal, () => undefined);
        items().push(item);
        hechos++;
      } catch {
        /* se reintenta en la próxima pasada */
      }
    }
    persistir();
    const porAprobar = items().filter((i) => i.estado === 'listo').length;
    if (hechos > 0) d.avisar(`Dejé ${hechos} cosa${hechos === 1 ? '' : 's'} lista${hechos === 1 ? '' : 's'} sin gastar tokens. ${porAprobar} esperan tu aprobación.`);
    return `${hechos} preparadas sin tokens, ${porAprobar} por aprobar`;
  }

  return { prepararSinTokens };
}
