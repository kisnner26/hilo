import { describe, expect, it } from 'vitest';
import { ahorroEfectivo, comentarioDeRevision, informe, presetAhorro, type Cambio } from '../src/index.js';
import { cargarPerfil } from '../src/index.js';
import { join } from 'node:path';

describe('ahorro de tokens opcional', () => {
  it('los tres preajustes ordenan de menos a más contexto', () => {
    const [max, eq, libre] = [presetAhorro('maximo'), presetAhorro('equilibrado'), presetAhorro('libre')];
    expect(max.presupuesto).toBeLessThan(eq.presupuesto);
    expect(eq.presupuesto).toBeLessThan(libre.presupuesto);
    expect(libre.activo).toBe(false);
    expect(max.maxSubagentes).toBeLessThan(libre.maxSubagentes);
  });

  it('apagado el interruptor general, manda el modo libre sin importar cada técnica', () => {
    const e = ahorroEfectivo({ activo: false, resumen: true, estiloBreve: true, presupuesto: 500 });
    expect(e.resumen).toBe(false);
    expect(e.estiloBreve).toBe(false);
    expect(e.presupuesto).toBe(6000);
    expect(e.respuestasInmediatas).toBe(true); // no cuesta tokens
  });

  it('encendido, respeta cada técnica elegida', () => {
    const e = ahorroEfectivo({ activo: true, extractos: false, presupuesto: 900 });
    expect(e.extractos).toBe(false);
    expect(e.resumen).toBe(true);
    expect(e.presupuesto).toBe(900);
  });

  it('sin configuración usa el equilibrado', () => {
    expect(ahorroEfectivo()).toEqual(presetAhorro('equilibrado'));
  });
});

describe('comentario de revisión', () => {
  const perfil = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));
  const malo: Cambio = { rama: 'x', titulo: 'x', cuerpo: '', archivos: [{ ruta: 'backend/A.java', estado: 'A', adiciones: 10, eliminaciones: 0 }] };
  it('junta todo en una lista numerada con lo que hay que correr', () => {
    const c = comentarioDeRevision(79, informe(malo, perfil));
    expect(c).toContain('Revisión de Integración del #79');
    expect(c).toMatch(/^1\. /m);
    expect(c).toContain('spotless:check');
  });
  it('si no hay nada que corregir lo dice', () => {
    expect(comentarioDeRevision(1, { ok: true, errores: [], avisos: [], verificaciones: [], lineas: 5 })).toContain('el formato está completo');
  });
});
