import { app, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as core from '@hilo/core';

export interface DepsMotores {
  config(): { motor?: 'auto' | core.MotorId; ollamaModelo?: string };
  guardar(patch: { motor?: 'auto' | core.MotorId; ollamaModelo?: string }): void;
}

export interface MotorElegido {
  id: core.MotorId;
  nombre: string;
  /** Solo para Ollama: el modelo concreto. */
  modelo?: string;
}

const rutaApple = (): string | undefined => {
  const r = app.isPackaged ? join(process.resourcesPath, 'native', 'hilo-ia') : resolve(__dirname, '../../native/bin/hilo-ia');
  return process.platform === 'darwin' && existsSync(r) ? r : undefined;
};

/** Qué IA hay disponible y cuál se usa. Se mira sola; la persona solo cambia si quiere. */
export function registrarMotores(d: DepsMotores) {
  let cache: { hasta: number; datos: Awaited<ReturnType<typeof leerEstados>> } | undefined;

  async function leerEstados() {
    const lista: core.EstadoMotor[] = [];
    for (const cli of ['claude', 'codex'] as const) {
      const s = await core.estadoSesion(cli);
      lista.push({
        id: cli,
        nombre: core.NOMBRE_MOTOR[cli],
        disponible: s.instalado && s.conectado,
        detalle: s.conectado ? s.detalle : s.instalado ? 'Instalado, sin sesión.' : 'No está instalado.',
        ...(s.conectado ? {} : { ayuda: s.instalado ? 'Inicia sesión en Ajustes › Cuentas.' : core.mensajeFaltante(cli) }),
        local: false,
        puedeEditar: true,
      });
    }
    const bin = rutaApple();
    let apple: core.EstadoMotor;
    if (process.platform !== 'darwin') apple = { id: 'apple', nombre: core.NOMBRE_MOTOR.apple, disponible: false, detalle: 'Solo en Mac con chip M.', local: true, puedeEditar: false };
    else if (!bin) apple = { id: 'apple', nombre: core.NOMBRE_MOTOR.apple, disponible: false, detalle: 'Esta copia de Hilo no lo incluye.', ayuda: 'Instala la versión más nueva de Hilo.', local: true, puedeEditar: false };
    else {
      const s = await core.sondearApple(bin);
      apple = { id: 'apple', nombre: core.NOMBRE_MOTOR.apple, disponible: s.disponible, detalle: s.disponible ? 'Corre en tu Mac, sin descargas ni suscripción.' : core.explicarRazonApple(s.razon), local: true, puedeEditar: false };
    }
    lista.push(apple);

    const ollamaBin = core.buscar('ollama');
    const o = await core.sondearOllama();
    const modelo = core.elegirModeloOllama(o.modelos, d.config().ollamaModelo);
    lista.push({
      id: 'ollama',
      nombre: core.NOMBRE_MOTOR.ollama,
      disponible: o.activo && Boolean(modelo),
      detalle: o.activo ? (modelo ? `Modelo ${modelo}, en tu equipo.` : 'Está encendido pero no tiene modelos.') : ollamaBin ? 'Instalado, pero apagado.' : 'No está instalado.',
      ...(o.activo && modelo ? {} : { ayuda: o.activo ? 'Descarga un modelo pequeño: ollama pull qwen2.5:3b' : ollamaBin ? 'Abre la aplicación Ollama y vuelve a mirar.' : 'Instálalo desde ollama.com y descarga un modelo pequeño.' }),
      local: true,
      puedeEditar: false,
    });
    lista.push({ id: 'reglas', nombre: core.NOMBRE_MOTOR.reglas, disponible: true, detalle: 'Busca en tus notas y en el mapa del proyecto. No necesita nada.', local: true, puedeEditar: false });
    return { lista, ollama: { activo: o.activo, modelos: o.modelos, elegido: modelo } };
  }

  async function estados(forzar = false) {
    if (!forzar && cache && cache.hasta > Date.now()) return cache.datos;
    const datos = await leerEstados();
    cache = { hasta: Date.now() + 30_000, datos };
    return datos;
  }

  async function elegido(): Promise<MotorElegido> {
    const e = await estados();
    const id = core.elegirMotor(e.lista, d.config().motor ?? 'auto');
    return { id, nombre: core.NOMBRE_MOTOR[id], ...(id === 'ollama' && e.ollama.elegido ? { modelo: e.ollama.elegido } : {}) };
  }

  async function generar(m: MotorElegido, p: core.PedidoLocal): Promise<string> {
    if (m.id === 'apple') {
      const bin = rutaApple();
      if (!bin) throw new Error('Apple Intelligence no está disponible en esta copia de Hilo.');
      return core.generarApple(bin, p);
    }
    if (m.id === 'ollama' && m.modelo) return core.generarOllama(p, m.modelo);
    throw new Error('Este motor no genera texto.');
  }

  ipcMain.handle('motor:estado', async (_e, forzar?: boolean) => {
    const e = await estados(Boolean(forzar));
    const el = core.elegirMotor(e.lista, d.config().motor ?? 'auto');
    return { ...e, elegido: el, preferido: d.config().motor ?? 'auto', ollamaModelo: d.config().ollamaModelo };
  });
  ipcMain.handle('motor:fijar', (_e, id: 'auto' | core.MotorId) => {
    d.guardar({ motor: id });
    cache = undefined;
  });
  ipcMain.handle('motor:ollama-modelo', (_e, modelo: string) => {
    d.guardar({ ollamaModelo: modelo });
    cache = undefined;
  });

  return { estados, elegido, generar };
}

/** Qué modelo usar según el motor del agente: si Claude no está pero Codex sí, no se insiste con Claude. */
export function asignadoParaAgente(motor: core.MotorId, base: core.ModeloAsignado): core.ModeloAsignado {
  if (motor === 'codex' && base.cli !== 'codex') return { cli: 'codex', modelo: '', esfuerzo: base.esfuerzo };
  if (motor === 'claude' && base.cli !== 'claude') return { cli: 'claude', modelo: 'claude-sonnet-5-5', esfuerzo: base.esfuerzo };
  return base;
}
