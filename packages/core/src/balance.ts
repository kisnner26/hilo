export interface PrEnCola {
  numero: number;
  autor: string;
  integrador?: string;
  /** Veces que el integrador ya pidió cambios o corrigió este PR. */
  rondas: number;
  lineas: number;
  listo: boolean;
}

export interface Asignacion {
  numero: number;
  integrador: string;
  motivo: string;
}

/**
 * Reparte los PR listos entre los integradores disponibles por carga (líneas pendientes),
 * sin asignar jamás al autor. Es estable: un PR ya asignado conserva su integrador.
 */
export function asignar(cola: PrEnCola[], integradores: string[]): Asignacion[] {
  const carga = new Map(integradores.map((i) => [i, 0]));
  for (const pr of cola) if (pr.integrador && carga.has(pr.integrador)) carga.set(pr.integrador, (carga.get(pr.integrador) ?? 0) + pr.lineas);
  const salida: Asignacion[] = [];
  for (const pr of [...cola].filter((x) => x.listo && !x.integrador).sort((a, b) => b.lineas - a.lineas)) {
    const elegibles = integradores.filter((i) => i !== pr.autor);
    if (elegibles.length === 0) continue;
    const elegido = [...elegibles].sort((a, b) => (carga.get(a) ?? 0) - (carga.get(b) ?? 0) || a.localeCompare(b))[0];
    if (!elegido) continue;
    carga.set(elegido, (carga.get(elegido) ?? 0) + pr.lineas);
    salida.push({ numero: pr.numero, integrador: elegido, motivo: `menor carga (${(carga.get(elegido) ?? 0) - pr.lineas} líneas)` });
  }
  return salida;
}

export interface Estadistica {
  prs: number;
  rondasPromedio: number;
  conMasDeTresRondas: number[];
  cargaPorIntegrador: Record<string, number>;
  /** Parte de las revisiones que hace el integrador con más carga, de 0 a 1. */
  concentracion: number;
}

/** Mide si el trabajo de revisión está repartido y cuántas vueltas cuesta cada PR. */
export function estadistica(cola: PrEnCola[], integradores: string[]): Estadistica {
  const carga: Record<string, number> = Object.fromEntries(integradores.map((i) => [i, 0]));
  for (const pr of cola) if (pr.integrador && pr.integrador in carga) carga[pr.integrador] = (carga[pr.integrador] ?? 0) + 1;
  const total = Object.values(carga).reduce((a, b) => a + b, 0);
  return {
    prs: cola.length,
    rondasPromedio: cola.length === 0 ? 0 : cola.reduce((s, p) => s + p.rondas, 0) / cola.length,
    conMasDeTresRondas: cola.filter((p) => p.rondas > 3).map((p) => p.numero),
    cargaPorIntegrador: carga,
    concentracion: total === 0 ? 0 : Math.max(...Object.values(carga)) / total,
  };
}
