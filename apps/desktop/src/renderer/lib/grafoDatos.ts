import { useSyncExternalStore } from 'react';
import type { GrafoG } from '@hilo/core/analisis-grafo';

/** El grafo cargado, compartido entre la vista del grafo, el inspector y la paleta. */
let datos: GrafoG = { nodos: [], enlaces: [] };
const suscritos = new Set<() => void>();

export const fijarGrafo = (g: GrafoG): void => {
  datos = g;
  suscritos.forEach((f) => f());
};
export const verGrafo = (): GrafoG => datos;
export const useGrafo = (): GrafoG =>
  useSyncExternalStore(
    (f) => {
      suscritos.add(f);
      return () => suscritos.delete(f);
    },
    () => datos,
  );
