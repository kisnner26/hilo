/**
 * Custodio de migraciones: antes de fusionar, cada migración debe tener un nombre válido, una versión que no
 * se repita y que sea posterior a la última que ya está en la rama principal (o en un PR que se fusiona antes).
 * Se mira todo el conjunto de PR a la vez y en el orden de fusión, que es lo que de verdad decide si chocan.
 */

export const MODULOS_BASE = ['comun', 'bfa'];

export interface MigracionesDePr {
  pr: number;
  /** Nombres de archivo de las migraciones que agrega el PR. */
  nombres: string[];
}

export interface ProblemaMigracion {
  pr: number;
  nombre: string;
  problema: string;
  /** Nombre con el que sí cumple, ya ordenado respecto a lo que se fusiona antes. */
  nuevoNombre?: string;
}

export const versionDe = (nombre: string): string | undefined => /^V(\d{12})__/.exec(nombre)?.[1];
const moduloDe = (nombre: string): string | undefined => /^V\d{12}__([a-z0-9]+)_/.exec(nombre)?.[1];

/** La versión que sigue: un minuto después, con el mismo formato aaaaMMddHHmm. */
export function siguienteVersion(v: string): string {
  const t = Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(8, 10), +v.slice(10, 12)) + 60_000;
  const d = new Date(t);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/**
 * `enMain`: nombres de las migraciones ya fusionadas. `prs`: los PR con migraciones, en el orden en que se fusionarán.
 * Devuelve lo que hay que corregir, con el nombre nuevo propuesto para cada caso.
 */
export function custodiarMigraciones(enMain: string[], prs: MigracionesDePr[], patron: RegExp, modulos: string[] = MODULOS_BASE): ProblemaMigracion[] {
  const conocidos = new Set([...modulos, ...enMain.map(moduloDe).filter((m): m is string => Boolean(m))]);
  const usadas = new Set(enMain.map(versionDe).filter((v): v is string => Boolean(v)));
  let ultima = [...usadas].sort().pop() ?? '000000000000';
  const salida: ProblemaMigracion[] = [];
  for (const { pr, nombres } of prs) {
    // Dentro del PR se conserva el orden relativo de sus migraciones.
    const ordenadas = [...nombres].sort((a, b) => (versionDe(a) ?? a).localeCompare(versionDe(b) ?? b));
    for (const nombre of ordenadas) {
      const problemas: string[] = [];
      const ver = versionDe(nombre);
      const mod = moduloDe(nombre);
      if (!patron.test(nombre)) problemas.push('el nombre no cumple V<12 dígitos>__<modulo>_<descripcion>.sql');
      else if (mod && !conocidos.has(mod)) problemas.push(`el módulo «${mod}» no existe (usa ${[...conocidos].sort().join(' o ')})`);
      let versionMala = !ver;
      if (ver && usadas.has(ver)) {
        problemas.push(`la versión ${ver} ya la usa otra migración`);
        versionMala = true;
      } else if (ver && ver <= ultima) {
        problemas.push(`la versión ${ver} no es posterior a la última (${ultima})`);
        versionMala = true;
      }
      let final = nombre;
      if (problemas.length > 0) {
        // Si la versión estaba bien y solo falla el nombre, se conserva: solo se cambia lo que está mal.
        const nueva = versionMala || !ver ? siguienteVersion(ultima) : ver;
        // Con un módulo desconocido se antepone `comun_` a todo lo que había: no se pierde ninguna palabra del nombre.
        const cuerpo = patron.test(nombre) && mod && !conocidos.has(mod) ? `comun_${nombre.replace(/^V\d{12}__/, '')}` : /^V\d{12}__/.test(nombre) ? nombre.replace(/^V\d{12}__/, '') : nombre.replace(/\.sql$/, '') + '.sql';
        final = `V${nueva}__${cuerpo}`;
        salida.push({ pr, nombre, problema: problemas.join('; '), ...(patron.test(final) ? { nuevoNombre: final } : {}) });
      }
      const v = versionDe(final);
      if (v) {
        usadas.add(v);
        if (v > ultima) ultima = v;
      }
    }
  }
  return salida;
}
