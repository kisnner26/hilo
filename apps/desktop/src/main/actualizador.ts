import { app, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import { accessSync, constants, createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as core from '@hilo/core';

export interface DepsActualizador {
  enviar(canal: string, datos: unknown): void;
  avisar(texto: string): void;
  auto(): boolean;
  fijarAuto(v: boolean): void;
}

/**
 * Actualizaciones desde la propia app. Revisar es automático (solo consulta la versión publicada);
 * descargar e instalar solo ocurre cuando la persona toca «Actualizar ahora».
 */
export function registrarActualizador(d: DepsActualizador): void {
  let ultima: core.Actualizacion | undefined;
  let aviso = '';
  let instalando = false;
  const evento = (e: Record<string, unknown>) => d.enviar('actualizar:evento', e);

  async function comprobar(): Promise<core.Actualizacion> {
    ultima = await core.buscarActualizacion(app.getVersion(), process.platform, process.arch);
    return ultima;
  }

  ipcMain.handle('actualizar:version', () => ({ version: app.getVersion(), empaquetada: app.isPackaged, plataforma: process.platform, auto: d.auto(), ultima }));
  ipcMain.handle('actualizar:comprobar', () => comprobar());
  ipcMain.handle('actualizar:auto', (_e, v: boolean) => d.fijarAuto(v));
  ipcMain.handle('actualizar:pagina', () => shell.openExternal(ultima?.pagina ?? `https://github.com/${core.REPO_HILO}/releases/latest`));

  ipcMain.handle('actualizar:instalar', async () => {
    if (instalando) return;
    const u = ultima ?? (await comprobar());
    if (!u.hay) throw new Error('Ya tienes la versión más nueva.');
    if (!app.isPackaged) throw new Error('Esta es una versión de desarrollo: solo la app instalada se actualiza sola.');
    if (!u.asset) {
      void shell.openExternal(u.pagina);
      throw new Error('No hay un archivo de esta versión para tu sistema. Te abrí la página de la versión.');
    }
    instalando = true;
    try {
      const dir = join(app.getPath('temp'), `hilo-actualizacion-${u.ultima}`);
      mkdirSync(dir, { recursive: true });
      const archivo = join(dir, u.asset.nombre.replace(/[^A-Za-z0-9._-]/g, '_'));
      evento({ tipo: 'descargando', bajados: 0, total: u.asset.tam });
      const r = await fetch(u.asset.url);
      if (!r.ok || !r.body) throw new Error(`GitHub respondió ${r.status} al descargar.`);
      let bajados = 0;
      let ultimoAviso = 0;
      const lector = Readable.fromWeb(r.body as never);
      lector.on('data', (c: Buffer) => {
        bajados += c.length;
        if (Date.now() - ultimoAviso > 150) {
          ultimoAviso = Date.now();
          evento({ tipo: 'descargando', bajados, total: u.asset!.tam });
        }
      });
      await pipeline(lector, createWriteStream(archivo));
      if (statSync(archivo).size !== u.asset.tam) throw new Error('La descarga quedó incompleta. Inténtalo de nuevo.');
      evento({ tipo: 'instalando' });
      await instalarArchivo(archivo);
    } catch (e) {
      instalando = false;
      aviso = e instanceof Error ? e.message : String(e);
      evento({ tipo: 'error', texto: aviso });
      throw e;
    }
  });

  async function instalarArchivo(archivo: string): Promise<void> {
    if (process.platform === 'darwin') {
      const bundle = resolve(app.getPath('exe'), '../../..');
      if (!bundle.endsWith('.app')) throw new Error('No se encontró dónde está instalada la app.');
      try {
        accessSync(dirname(bundle), constants.W_OK);
      } catch {
        throw new Error(`No tengo permiso para escribir en ${dirname(bundle)}. Mueve Hilo a Aplicaciones o a ~/Applications.`);
      }
      const sh = join(dirname(archivo), 'actualizar.sh');
      writeFileSync(sh, core.scriptReemplazoMac({ pid: process.pid, zip: archivo, destino: bundle }), { mode: 0o755 });
      spawn('sh', [sh], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      const fallo = await shell.openPath(archivo);
      if (fallo) throw new Error(`No se pudo abrir el instalador: ${fallo}`);
    } else if (process.env.APPIMAGE) {
      const sh = join(dirname(archivo), 'actualizar.sh');
      writeFileSync(sh, core.scriptReemplazoAppImage({ pid: process.pid, nuevo: archivo, destino: process.env.APPIMAGE }), { mode: 0o755 });
      spawn('sh', [sh], { detached: true, stdio: 'ignore' }).unref();
    } else {
      throw new Error('No se pudo saber dónde está el AppImage. Descarga la versión nueva desde GitHub.');
    }
    evento({ tipo: 'reiniciando' });
    setTimeout(() => app.quit(), 600);
  }

  // Revisión automática: solo consulta; avisa una vez por versión.
  let avisada = '';
  const revisar = async () => {
    if (!d.auto() || !app.isPackaged) return;
    try {
      const u = await comprobar();
      if (u.hay && avisada !== u.ultima) {
        avisada = u.ultima;
        d.avisar(`Hay una versión nueva de Hilo (${u.ultima}). Actualízala en Ajustes › Actualizaciones.`);
        evento({ tipo: 'disponible', ultima: u.ultima });
      }
    } catch {
      /* sin internet o límite de GitHub: se reintenta más tarde */
    }
  };
  setTimeout(() => void revisar(), 15_000);
  setInterval(() => void revisar(), 6 * 3_600_000);
}
