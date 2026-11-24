const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** De un texto largo, solo los párrafos que tocan la consulta (y los títulos), en su orden: menos tokens, mismo sentido. */
export function extractoRelevante(texto: string, consulta: string, maxCaracteres = 1200): string {
  const claves = sinTildes(consulta).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const parrafos = texto.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const puntuados = parrafos.map((p, i) => ({ p, i, s: claves.reduce((n, c) => n + (sinTildes(p).includes(c) ? 1 : 0), 0) + (/^#/.test(p) ? 0.5 : 0) }));
  const elegidos: typeof puntuados = [];
  let usado = 0;
  for (const x of [...puntuados].sort((a, b) => b.s - a.s || a.i - b.i)) {
    if (x.s === 0 && elegidos.length > 0) break;
    if (usado + x.p.length > maxCaracteres && elegidos.length > 0) continue;
    elegidos.push(x);
    usado += x.p.length;
  }
  return elegidos.sort((a, b) => a.i - b.i).map((x) => (x.p.length > maxCaracteres ? `${x.p.slice(0, maxCaracteres)}…` : x.p)).join('\n\n');
}
