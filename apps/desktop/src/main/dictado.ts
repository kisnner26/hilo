import { app, ipcMain, shell, systemPreferences } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Dictado por voz. En macOS un ayudante nativo escucha el micrófono y usa el reconocimiento de voz del sistema.
 * En otros sistemas no hay ayudante: la app indica el dictado del propio sistema (Win+H en Windows).
 */

const ruta = (): string | undefined => {
  const r = app.isPackaged ? join(process.resourcesPath, 'native', 'hilo-dictado') : resolve(__dirname, '../../native/bin/hilo-dictado');
  return process.platform === 'darwin' && existsSync(r) ? r : undefined;
};

let proceso: ChildProcessWithoutNullStreams | undefined;

export function registrarDictado(enviar: (canal: string, datos: unknown) => void): void {
  const emitir = (e: Record<string, unknown>) => enviar('dictado:evento', e);

  ipcMain.handle('dictado:estado', () => ({ disponible: Boolean(ruta()), plataforma: process.platform, escuchando: Boolean(proceso) }));

  ipcMain.handle('dictado:iniciar', async (_e, idioma: string) => {
    const bin = ruta();
    if (!bin) return emitir({ tipo: 'error', codigo: 'sin-ayudante' });
    if (proceso) return;
    if (process.platform === 'darwin') {
      // Hilo pide el micrófono él mismo: así el permiso queda a nombre de la app y el ayudante lo hereda.
      const ok = await systemPreferences.askForMediaAccess('microphone').catch(() => false);
      if (!ok) return emitir({ tipo: 'error', codigo: 'permiso-microfono' });
    }
    const lengua = /^[a-z]{2}(-[A-Za-z]{2})?$/.test(idioma) ? idioma : 'es-MX';
    const p = spawn(bin, [lengua, '2.2'], { stdio: ['pipe', 'pipe', 'pipe'] });
    proceso = p;
    let resto = '';
    p.stdout.on('data', (d: Buffer) => {
      resto += d.toString('utf8');
      const lineas = resto.split('\n');
      resto = lineas.pop() ?? '';
      for (const l of lineas) {
        try {
          const j = JSON.parse(l) as { estado?: string; parcial?: string; final?: string; error?: string };
          if (j.parcial !== undefined) emitir({ tipo: 'parcial', texto: j.parcial });
          else if (j.final !== undefined) emitir({ tipo: 'final', texto: j.final });
          else if (j.estado) emitir({ tipo: 'estado', estado: j.estado });
          else if (j.error) emitir({ tipo: 'error', codigo: j.error });
        } catch {
          /* líneas de aviso del sistema: se ignoran */
        }
      }
    });
    p.on('error', () => emitir({ tipo: 'error', codigo: 'no-arranca' }));
    p.on('close', () => {
      proceso = undefined;
      emitir({ tipo: 'cerrado' });
    });
  });

  ipcMain.handle('dictado:detener', () => {
    const p = proceso;
    if (!p) return;
    p.stdin.write('stop\n');
    setTimeout(() => p.kill(), 4000);
  });

  ipcMain.handle('dictado:permisos', (_e, cual: 'microfono' | 'voz') =>
    shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${cual === 'voz' ? 'SpeechRecognition' : 'Microphone'}`),
  );

  app.on('before-quit', () => proceso?.kill());
}
