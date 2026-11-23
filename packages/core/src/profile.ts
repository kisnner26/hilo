import { readFileSync } from 'node:fs';

export type RolId = 'documentador' | 'desarrollador' | 'tester' | 'integrador';
export type CliId = 'claude' | 'codex';
export type Esfuerzo = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModeloAsignado {
  cli: CliId;
  modelo: string;
  esfuerzo: Esfuerzo;
}

/** Todo lo que cambia de un proyecto a otro vive aquí; el resto del núcleo es genérico. */
export interface Perfil {
  id: string;
  name: string;
  idioma: string;
  repo: { owner: string; name: string; base: string };
  clickup: { workspaceId: string; listas: Record<string, string> };
  codigoTarea: string;
  rama: { tipos: string[]; patron: string; ejemplo: string };
  titulo: { patron: string; ejemplo: string };
  limites: { lineasPorPr: number; lineasMaximas: number };
  cuerpo: {
    primeraLinea: string;
    secciones: string[];
    campos: { etiqueta: string; obligatorio: boolean }[];
    marcadoresDePlantilla: string[];
  };
  archivos: {
    prohibidos: string[];
    mdNuevoSoloEn: string[];
    migraciones: { carpeta: string; nombre: string };
    ajenosAlModulo: string[];
  };
  testing: { exigidoPara: string; exentos: string; etiqueta: string };
  verificaciones: { backend: string[]; frontend: string[] };
  evidencia: { campos: string[] };
  roles: Record<RolId, { puede: string[]; noPuede: string[] }>;
  integradores: string[];
  modelos: Record<'orquestador' | 'desarrollo' | 'documentacion' | 'integracion' | 'testing', ModeloAsignado>;
}

/** Sustituye {codigo} por el código de tarea ya escapado, para armar expresiones regulares. */
export function conCodigo(patron: string, codigo: string): RegExp {
  const escapado = codigo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(patron.replaceAll('{codigo}', escapado));
}

export function cargarPerfil(ruta: string): Perfil {
  const crudo = JSON.parse(readFileSync(ruta, 'utf8')) as Perfil;
  const faltan = ['rama', 'titulo', 'limites', 'cuerpo', 'archivos', 'roles', 'modelos'].filter(
    (k) => !(k in crudo),
  );
  if (faltan.length > 0) throw new Error(`Perfil inválido, faltan: ${faltan.join(', ')}`);
  return crudo;
}

/** Extrae el código de tarea de un título "[CODIGO] texto" o de una rama "tipo/nombre-CODIGO". */
export function codigoDeTitulo(titulo: string): string | undefined {
  return /^\[([A-Z0-9-]+)\]/.exec(titulo)?.[1];
}

export function codigoDeRama(rama: string, perfil: Perfil): string | undefined {
  const sufijo = /^[a-z]+\/[a-z0-9-]+?-([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)$/.exec(rama)?.[1];
  return sufijo && new RegExp(perfil.codigoTarea).test(sufijo) ? sufijo : undefined;
}
