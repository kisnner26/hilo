import type { EnlaceVista, NodoVista } from './galaxy';

/** Grafo sintético con la forma de un proyecto real: comunidades densas y pocos puentes. */
export function grafoDemo(): { nodos: NodoVista[]; enlaces: EnlaceVista[] } {
  const carpetas = ['contexto', 'contratos', 'backend', 'frontend', 'pruebas', 'decisiones', 'tareas', 'hilos', 'integración'];
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  const nodos: NodoVista[] = [];
  const enlaces: EnlaceVista[] = [];
  carpetas.forEach((nombre, c) => {
    const n = 55 + Math.floor(azar() * 70);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `${nombre}-${i}`;
      ids.push(id);
      nodos.push({ id, label: `${nombre}/${nombre === 'tareas' ? 'BFA-BE-' + (i + 1) : 'nota-' + (i + 1)}`, comunidad: c, nombreComunidad: nombre, tipo: 'nota', archivo: `${nombre}/${nombre === 'tareas' ? 'BFA-BE-' + (i + 1) : 'nota-' + (i + 1)}.md` });
      if (i > 0) {
        const padre = i < 6 ? 0 : Math.floor(azar() * i * 0.6);
        enlaces.push({ origen: id, destino: ids[padre] as string, relacion: 'enlaza' });
        if (azar() < 0.25) enlaces.push({ origen: id, destino: ids[Math.floor(azar() * i)] as string, relacion: 'enlaza' });
      }
    }
  });
  for (let k = 0; k < 90; k++) {
    const a = nodos[Math.floor(azar() * nodos.length)] as NodoVista;
    const b = nodos[Math.floor(azar() * nodos.length)] as NodoVista;
    if (a.comunidad !== b.comunidad) enlaces.push({ origen: a.id, destino: b.id, relacion: 'referencia' });
  }
  return { nodos, enlaces };
}
