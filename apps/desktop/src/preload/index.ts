import { contextBridge, ipcRenderer } from 'electron';

const CANALES = [
  'config:get',
  'config:set',
  'perfil:get',
  'dialogo:abrir',
  'grafo:cargar',
  'nota:leer',
  'notas:lista',
  'sesion:estado',
  'sesion:iniciar',
  'pr:revisar',
  'hilos:lista',
  'hilos:guardar',
  'contexto:paquete',
  'portapapeles:copiar',
  'agentes:orquestar',
] as const;

contextBridge.exposeInMainWorld('hilo', {
  invocar: (canal: (typeof CANALES)[number], ...args: unknown[]) => {
    if (!CANALES.includes(canal)) throw new Error(`Canal no permitido: ${canal}`);
    return ipcRenderer.invoke(canal, ...args);
  },
  alEvento: (cb: (e: unknown) => void) => {
    const f = (_: unknown, e: unknown) => cb(e);
    ipcRenderer.on('agente:evento', f);
    return () => ipcRenderer.off('agente:evento', f);
  },
});
