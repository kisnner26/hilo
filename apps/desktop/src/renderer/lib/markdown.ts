const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function enLinea(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, '<span class="enlace-nota">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

/** Markdown mínimo y seguro (escapa todo antes): títulos, listas, tablas simples, código y enlaces. */
export function mdAHtml(texto: string): string {
  const salida: string[] = [];
  let lista = false;
  let codigo = false;
  const cerrarLista = () => {
    if (lista) salida.push('</ul>');
    lista = false;
  };
  for (const linea of texto.split('\n')) {
    if (linea.startsWith('```')) {
      cerrarLista();
      salida.push(codigo ? '</pre>' : '<pre>');
      codigo = !codigo;
      continue;
    }
    if (codigo) {
      salida.push(`${esc(linea)}\n`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(linea);
    if (h) {
      cerrarLista();
      salida.push(`<h${h[1]!.length}>${enLinea(h[2]!)}</h${h[1]!.length}>`);
      continue;
    }
    const li = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(linea);
    if (li) {
      if (!lista) salida.push('<ul>');
      lista = true;
      salida.push(`<li>${enLinea(li[1]!)}</li>`);
      continue;
    }
    cerrarLista();
    if (/^\|.*\|$/.test(linea)) {
      if (/^\|[\s:|-]+\|$/.test(linea)) continue;
      salida.push(`<div class="fila-tabla">${linea.split('|').slice(1, -1).map((c) => `<span>${enLinea(c.trim())}</span>`).join('')}</div>`);
      continue;
    }
    salida.push(linea.trim() === '' ? '' : `<p>${enLinea(linea)}</p>`);
  }
  cerrarLista();
  if (codigo) salida.push('</pre>');
  return salida.join('\n');
}
