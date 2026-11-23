import { codigoDeRama, codigoDeTitulo, conCodigo, type Perfil } from './profile.js';

export type Gravedad = 'error' | 'aviso';

export interface Hallazgo {
  regla: string;
  gravedad: Gravedad;
  mensaje: string;
  /** Cómo corregirlo, en una línea que el autor pueda copiar. */
  arreglo?: string;
}

export interface ArchivoCambiado {
  ruta: string;
  estado: 'A' | 'M' | 'D' | 'R';
  adiciones: number;
  eliminaciones: number;
}

export interface Cambio {
  rama: string;
  titulo: string;
  cuerpo: string;
  archivos: ArchivoCambiado[];
  /** Etiquetas del PR en GitHub; solo se conocen una vez abierto. */
  etiquetas?: string[];
}

const error = (regla: string, mensaje: string, arreglo?: string): Hallazgo => ({
  regla,
  gravedad: 'error',
  mensaje,
  ...(arreglo ? { arreglo } : {}),
});
const aviso = (regla: string, mensaje: string, arreglo?: string): Hallazgo => ({
  regla,
  gravedad: 'aviso',
  mensaje,
  ...(arreglo ? { arreglo } : {}),
});

/** Réplica de lo que hace el check `reglas` del CI, más lo que hoy se revisa a mano. */
export function validarRama(c: Cambio, p: Perfil): Hallazgo[] {
  const codigo = codigoDeTitulo(c.titulo) ?? codigoDeRama(c.rama, p);
  if (!codigo) {
    return [
      error(
        'rama',
        `No se puede deducir el código de tarea de la rama "${c.rama}" ni del título.`,
        `Usa ${p.rama.ejemplo}`,
      ),
    ];
  }
  return conCodigo(p.rama.patron, codigo).test(c.rama)
    ? []
    : [
        error(
          'rama',
          `La rama "${c.rama}" no cumple tipo/nombre-${codigo}.`,
          `Una rama no se puede renombrar: crea una nueva con ese nombre, súbela y abre un PR nuevo. Ejemplo: ${p.rama.ejemplo}`,
        ),
      ];
}

export function validarTitulo(c: Cambio, p: Perfil): Hallazgo[] {
  const codigo = codigoDeRama(c.rama, p);
  if (!codigo) return [error('titulo', 'No hay código de tarea en la rama para validar el título.')];
  return conCodigo(p.titulo.patron, codigo).test(c.titulo)
    ? []
    : [
        error(
          'titulo',
          `El título "${c.titulo}" no cumple [${codigo}] descripción.`,
          `Ejemplo: ${p.titulo.ejemplo}. El título se lee al crear el run: corregirlo exige un push nuevo.`,
        ),
      ];
}

export function validarCuerpo(c: Cambio, p: Perfil): Hallazgo[] {
  const salida: Hallazgo[] = [];
  const codigo = codigoDeTitulo(c.titulo) ?? codigoDeRama(c.rama, p);
  const lineas = c.cuerpo.split('\n');
  const primera = (lineas.find((l) => /^[-*]?\s*Tarea ClickUp:/.test(l)) ?? '').replace(/^[-*]\s*/, '').trim();

  if (p.cuerpo.marcadoresDePlantilla.some((m) => c.cuerpo.includes(m))) {
    salida.push(
      error('cuerpo', 'El cuerpo sigue con texto de la plantilla sin completar.', 'Reemplaza <código> y <id interno> por los reales.'),
    );
  }
  if (codigo && !conCodigo(p.cuerpo.primeraLinea, codigo).test(primera)) {
    salida.push(
      error(
        'cuerpo',
        `Falta la línea "Tarea ClickUp: ${codigo} · CU-<id>" o no cumple el formato.`,
        `Escribe: Tarea ClickUp: ${codigo} · CU-<id interno de ClickUp>`,
      ),
    );
  }
  for (const s of p.cuerpo.secciones) {
    if (!c.cuerpo.includes(s)) salida.push(error('cuerpo', `Falta la sección "${s}".`));
  }
  for (const campo of p.cuerpo.campos) {
    const re = new RegExp(`${campo.etiqueta.replace(/[/()]/g, '\\$&')}[ \\t]*:[ \\t]*(.*)$`, 'm');
    const valor = re.exec(c.cuerpo)?.[1]?.trim() ?? '';
    if (campo.obligatorio && valor.length === 0) {
      salida.push(error('cuerpo', `El campo "${campo.etiqueta}" está vacío.`, 'Si no aplica, escribe "no aplica" y el motivo.'));
    }
  }
  if (!/- \[x\]/i.test(c.cuerpo)) {
    salida.push(aviso('cuerpo', 'Ninguna validación está marcada como hecha.', 'Marca solo las que corriste y pega el resultado.'));
  }
  return salida;
}

export function validarTamano(c: Cambio, p: Perfil): Hallazgo[] {
  const total = c.archivos.reduce((n, a) => n + a.adiciones + a.eliminaciones, 0);
  const { lineasPorPr, lineasMaximas } = p.limites;
  if (total > lineasMaximas) {
    return [error('tamano', `El PR cambia ${total} líneas; el máximo es ${lineasMaximas}.`, 'Pártelo por capas (modelo, persistencia, servicio, API, pruebas).')];
  }
  if (total > lineasPorPr) {
    return [aviso('tamano', `El PR cambia ${total} líneas; lo acordado es ≈${lineasPorPr}.`, 'Pide la excepción de tamaño explícita o pártelo.')];
  }
  return [];
}

export function validarArchivos(c: Cambio, p: Perfil): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const a of c.archivos) {
    if (p.archivos.prohibidos.some((r) => new RegExp(r).test(a.ruta))) {
      salida.push(error('archivos', `No se sube "${a.ruta}".`, 'Quítalo del commit y agrégalo a .gitignore.'));
    }
    if (a.estado === 'A' && a.ruta.endsWith('.md') && !p.archivos.mdNuevoSoloEn.some((r) => new RegExp(r).test(a.ruta))) {
      salida.push(error('archivos', `El .md nuevo "${a.ruta}" debe ir en docs/.`, 'Muévelo a docs/ o a un README.md.'));
    }
    if (p.archivos.ajenosAlModulo.some((r) => new RegExp(r).test(a.ruta))) {
      salida.push(aviso('archivos', `"${a.ruta}" suele ser ajeno a la tarea.`, 'Si no es parte del cambio, quítalo para no inflar el PR.'));
    }
    const m = p.archivos.migraciones;
    if (a.ruta.startsWith(`${m.carpeta}/`) && a.ruta.endsWith('.sql')) {
      const nombre = a.ruta.slice(m.carpeta.length + 1);
      if (!new RegExp(m.nombre).test(nombre)) {
        salida.push(error('migraciones', `Nombre de migración inválido: ${nombre}.`, 'Formato V<12 dígitos>__<modulo>_<descripcion>.sql'));
      }
      if (a.estado !== 'A') {
        salida.push(error('migraciones', `No se modifican ni borran migraciones fusionadas: ${nombre}.`, 'Crea una migración nueva.'));
      }
    }
  }
  const versiones = c.archivos
    .filter((a) => a.estado === 'A' && a.ruta.startsWith(`${p.archivos.migraciones.carpeta}/`))
    .map((a) => /V(\d+)__/.exec(a.ruta)?.[1])
    .filter((v): v is string => Boolean(v));
  for (const v of new Set(versiones.filter((x, i) => versiones.indexOf(x) !== i))) {
    salida.push(error('migraciones', `Versión de migración duplicada: ${v}.`));
  }
  return salida;
}

/** `testing-ok` solo se exige a código de tareas GEN o BFA que no sean -TEST ni -INT. */
export function exigeTesting(codigo: string, p: Perfil): boolean {
  return new RegExp(p.testing.exigidoPara).test(codigo) && !new RegExp(p.testing.exentos).test(codigo);
}

export function validarEtiquetas(c: Cambio, p: Perfil): Hallazgo[] {
  const codigo = codigoDeTitulo(c.titulo);
  if (!codigo || !c.etiquetas) return [];
  if (exigeTesting(codigo, p) && !c.etiquetas.includes(p.testing.etiqueta)) {
    return [aviso('testing', `Falta la etiqueta ${p.testing.etiqueta}.`, 'La pone Testing sobre el SHA final; después hay que volver a correr el check.')];
  }
  return [];
}

export function validarTodo(c: Cambio, p: Perfil): Hallazgo[] {
  return [
    ...validarRama(c, p),
    ...validarTitulo(c, p),
    ...validarCuerpo(c, p),
    ...validarTamano(c, p),
    ...validarArchivos(c, p),
    ...validarEtiquetas(c, p),
  ];
}
