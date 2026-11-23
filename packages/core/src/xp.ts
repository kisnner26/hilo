/** Prácticas de XP aplicadas a un calendario corto: piezas pequeñas, parejas, prueba primero, integrar a diario. */

export interface TareaPlan {
  codigo: string;
  titulo: string;
  lineas: number;
  dependeDe: string[];
  rol: 'documentador' | 'desarrollador' | 'tester' | 'integrador';
  /** Quien puede hacerla; vacío = cualquiera del rol. */
  responsables?: string[];
}

export interface Pieza {
  codigo: string;
  pieza: string;
  lineas: number;
  rol: TareaPlan['rol'];
  pareja?: string;
  ciclo: string[];
}

export interface Dia {
  dia: number;
  piezas: Pieza[];
  integracion: string;
}

const CICLO = ['escribe la prueba que falla', 'lo mínimo para que pase', 'refactoriza', 'preflight y abre el PR en borrador'];

/** Parte una tarea en piezas que respetan el tope de líneas por PR. */
export function partir(t: TareaPlan, tope = 400): Pieza[] {
  const n = Math.max(1, Math.ceil(t.lineas / tope));
  return Array.from({ length: n }, (_, i) => ({
    codigo: t.codigo,
    pieza: n === 1 ? t.titulo : `${t.titulo} (pieza ${i + 1} de ${n})`,
    lineas: Math.ceil(t.lineas / n),
    rol: t.rol,
    ciclo: t.rol === 'desarrollador' ? CICLO : ['borrador', 'revisión cruzada', 'versión final'],
  }));
}

function ordenTopologico(ts: TareaPlan[]): TareaPlan[] {
  const porCodigo = new Map(ts.map((t) => [t.codigo, t]));
  const visto = new Set<string>();
  const salida: TareaPlan[] = [];
  const visitar = (t: TareaPlan, pila: string[]) => {
    if (visto.has(t.codigo)) return;
    if (pila.includes(t.codigo)) throw new Error(`Dependencia circular: ${[...pila, t.codigo].join(' -> ')}`);
    for (const d of t.dependeDe) {
      const dep = porCodigo.get(d);
      if (dep) visitar(dep, [...pila, t.codigo]);
    }
    visto.add(t.codigo);
    salida.push(t);
  };
  for (const t of ts) visitar(t, []);
  return salida;
}

/**
 * Reparte las piezas en `dias` días con una capacidad de líneas por día.
 * Una pieza no empieza antes del día siguiente al de su última dependencia, y cada día cierra con una integración.
 */
export function planificar(tareas: TareaPlan[], dias: number, capacidadPorDia: number, tope = 400): Dia[] {
  const plan: Dia[] = Array.from({ length: dias }, (_, i) => ({ dia: i + 1, piezas: [], integracion: 'fusionar lo aprobado, actualizar el tablero, avisar al siguiente' }));
  const finDe = new Map<string, number>();
  for (const t of ordenTopologico(tareas)) {
    const desde = Math.max(1, ...t.dependeDe.map((d) => (finDe.get(d) ?? 0) + 1));
    let ultimo = desde;
    for (const pieza of partir(t, tope)) {
      let d = ultimo;
      while (d <= dias && plan[d - 1]!.piezas.reduce((s, p) => s + p.lineas, 0) + pieza.lineas > capacidadPorDia) d++;
      if (d > dias) d = dias;
      const del_dia = plan[d - 1]!;
      del_dia.piezas.push({ ...pieza, ...(pieza.rol === 'desarrollador' ? { pareja: 'tester' } : {}) });
      ultimo = d;
    }
    finDe.set(t.codigo, ultimo);
  }
  return plan;
}

export function desbordes(plan: Dia[], capacidadPorDia: number): number[] {
  return plan.filter((d) => d.piezas.reduce((s, p) => s + p.lineas, 0) > capacidadPorDia).map((d) => d.dia);
}
