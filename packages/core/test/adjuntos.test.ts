import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { clasificar, describirBinario, esImagenDeTexto, esTexto, extraerTexto, extensionDe, leerZip, planDeImagen, podarTexto, resumirTabla, textoDeOffice, tokensDeImagen } from '../src/index.js';

/** Escribe un ZIP de verdad (con deflate) para probar la lectura de documentos de Office. */
function zip(entradas: Record<string, string>): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let pos = 0;
  for (const [nombre, contenido] of Object.entries(entradas)) {
    const n = Buffer.from(nombre);
    const crudo = Buffer.from(contenido);
    const comp = deflateRawSync(crudo);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc32(crudo), 14);
    l.writeUInt32LE(comp.length, 18);
    l.writeUInt32LE(crudo.length, 22);
    l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(crudo), 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(crudo.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(pos, 42);
    locales.push(l, n, comp);
    centrales.push(c, n);
    pos += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(entradas).length, 8);
  fin.writeUInt16LE(Object.keys(entradas).length, 10);
  fin.writeUInt32LE(cd.length, 12);
  fin.writeUInt32LE(pos, 16);
  return Buffer.concat([...locales, cd, fin]);
}

describe('clasificar archivos', () => {
  it('reconoce imágenes y PDF por sus primeros bytes aunque el nombre mienta', () => {
    expect(clasificar('captura.dat', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2]))).toEqual({ tipo: 'imagen', formato: 'png' });
    expect(clasificar('x', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ tipo: 'imagen', formato: 'jpg' });
    expect(clasificar('informe', Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toEqual({ tipo: 'pdf', formato: 'pdf' });
  });
  it('separa Office de un zip cualquiera', () => {
    const p = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
    expect(clasificar('a.docx', p).tipo).toBe('office');
    expect(clasificar('a.zip', p).tipo).toBe('comprimido');
  });
  it('reconoce código, datos y texto sin extensión', () => {
    const t = new TextEncoder().encode('hola');
    expect(clasificar('A.java', t).tipo).toBe('texto');
    expect(clasificar('datos.csv', t).tipo).toBe('datos');
    expect(clasificar('LEEME', t).tipo).toBe('texto');
    expect(clasificar('raro.xyz', Uint8Array.from([0, 1, 2, 3]))).toEqual({ tipo: 'otro', formato: 'xyz' });
  });
  it('distingue texto de binario', () => {
    expect(esTexto(new TextEncoder().encode('una línea\ncon acentos: áéí'))).toBe(true);
    expect(esTexto(Uint8Array.from([65, 0, 66]))).toBe(false);
    expect(extensionDe('/a/b/Informe.Final.PDF')).toBe('pdf');
  });
});

describe('imágenes y su costo', () => {
  it('estima los tokens por área y respeta el tope', () => {
    expect(tokensDeImagen(1000, 750)).toBe(1000);
    expect(tokensDeImagen(4000, 3000)).toBe(1600);
  });
  it('reduce el lado largo y nunca agranda', () => {
    expect(planDeImagen(2560, 2000, 1280)).toEqual({ ancho: 1280, alto: 1000, reducir: true });
    expect(planDeImagen(800, 600, 1280)).toEqual({ ancho: 800, alto: 600, reducir: false });
  });
  it('una captura con mucho texto se manda como texto; una foto con poco, no', () => {
    const lineas = Array.from({ length: 20 }, (_, i) => `línea ${i} del registro con el error número ${i}`).join('\n');
    expect(esImagenDeTexto(lineas)).toBe(true);
    expect(esImagenDeTexto('Hola\nAna')).toBe(false);
  });
});

describe('documentos de Office', () => {
  it('lee el texto de un docx con sus párrafos y entidades', () => {
    const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Informe &amp; resultados</w:t></w:r></w:p><w:p><w:r><w:t>Segunda </w:t></w:r><w:r><w:t>línea</w:t></w:r></w:p></w:body></w:document>' });
    expect(textoDeOffice(docx, 'docx')).toBe('Informe & resultados\nSegunda línea');
  });
  it('lee las diapositivas de un pptx en orden numérico', () => {
    const pptx = zip({ 'ppt/slides/slide10.xml': '<a:t>diez</a:t>', 'ppt/slides/slide2.xml': '<a:t>dos</a:t>', 'ppt/slides/slide1.xml': '<a:t>uno</a:t>' });
    const t = textoDeOffice(pptx, 'pptx');
    expect(t.indexOf('uno')).toBeLessThan(t.indexOf('dos'));
    expect(t.indexOf('dos')).toBeLessThan(t.indexOf('diez'));
  });
  it('lee una hoja de xlsx resolviendo el texto compartido', () => {
    const xlsx = zip({
      'xl/sharedStrings.xml': '<sst><si><t>nombre</t></si><si><t>nota</t></si><si><t>Ana</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9.5</v></c></row></sheetData></worksheet>',
    });
    expect(textoDeOffice(xlsx, 'xlsx')).toBe('## hoja 1\nnombre\tnota\nAna\t9.5');
  });
  it('un zip dañado da error claro y extraerTexto no revienta', () => {
    expect(() => leerZip(Buffer.from('no es zip'))).toThrow('ZIP');
    expect(extraerTexto('a.docx', 'office', 'docx', Buffer.from('no es zip'))).toBeUndefined();
  });
});

describe('texto, tablas y binarios', () => {
  it('una tabla grande se resume con encabezado, filas y total', () => {
    const csv = ['id,valor', ...Array.from({ length: 500 }, (_, i) => `${i},${i * 2}`)].join('\n');
    const r = resumirTabla(csv);
    expect(r.split('\n').length).toBeLessThan(40);
    expect(r).toContain('id,valor');
    expect(r).toContain('500 en total');
    expect(r).toContain('499,998');
  });
  it('poda un texto largo y conserva lo que toca la pregunta', () => {
    const relleno = Array.from({ length: 300 }, (_, i) => `Párrafo de relleno número ${i} sin nada importante.`).join('\n\n');
    const texto = `Introducción del proyecto.\n\n${relleno}\n\nEl baremo se aprueba con evidencia documental.\n\n${relleno}`;
    const p = podarTexto(texto, 'cómo se aprueba el baremo con evidencia', 400);
    expect(p.length).toBeLessThan(texto.length / 10);
    expect(p).toContain('Introducción del proyecto');
    expect(p).toContain('baremo se aprueba con evidencia');
    expect(podarTexto('corto', 'x', 400)).toBe('corto');
  });
  it('describe un binario por su firma y muestra sus cadenas legibles', () => {
    const b = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0]), Buffer.from('/lib/ld-linux.so.2'), Buffer.from([0, 0])]);
    const d = describirBinario('prog', b);
    expect(d).toContain('ELF');
    expect(d).toContain('ld-linux');
  });
  it('lista el contenido de un zip común', () => {
    const r = extraerTexto('a.zip', 'comprimido', 'zip', zip({ 'src/a.txt': 'hola', 'LEEME.md': 'x' }));
    expect(r?.texto).toContain('2 archivos');
    expect(r?.texto).toContain('src/a.txt');
  });
});
