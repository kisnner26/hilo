import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { cargarPerfil, cuerpoDePr, informe, type Cambio } from '../src/index.js';

const perfil = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));

const cuerpoBueno = cuerpoDePr({
  codigo: 'BFA-BE-01',
  idClickup: '86bcvah6b',
  modulo: 'bfa',
  resumen: 'Perfil de las 13 subpruebas',
  rf: 'RF-BFA-GEN-03',
  casosDeUso: 'CU-BFA-P03',
  contrato: 'E2, sin migraciones',
  validaciones: [{ texto: 'mvn verify', hecha: true }],
});

const bueno: Cambio = {
  rama: 'feature/rodrigo-ramirez-BFA-BE-01',
  titulo: '[BFA-BE-01] Módulo BFA y configuración de las 13 subpruebas',
  cuerpo: cuerpoBueno,
  archivos: [{ ruta: 'backend/src/main/java/A.java', estado: 'A', adiciones: 300, eliminaciones: 0 }],
};

const reglas = (c: Cambio) => informe(c, perfil).errores.map((h) => h.regla);

describe('preflight de PR (formato del repositorio)', () => {
  it('acepta un PR completo', () => {
    const i = informe(bueno, perfil);
    expect(i.errores).toEqual([]);
    expect(i.ok).toBe(true);
    expect(i.verificaciones).toContain('mvn -f backend/pom.xml spotless:check');
  });

  it('rechaza el título que es el nombre de la rama (caso real del #79)', () => {
    expect(reglas({ ...bueno, titulo: 'Feature/rodrigo-ramirez-bfa-be-01' })).toContain('titulo');
  });

  it('rechaza la rama sin el código de tarea al final (caso real del #78)', () => {
    const c = { ...bueno, rama: 'CU-86bcvah6b_BFA-BE-01-integrar_RODRIGO' };
    expect(reglas(c)).toContain('rama');
  });

  it('rechaza el cuerpo que sigue siendo la plantilla', () => {
    const plantilla = '## Tarea y alcance\n\n- Tarea ClickUp: <código> · CU-<id interno>\n- Módulo:\n- Resumen del cambio:\n';
    const e = informe({ ...bueno, cuerpo: plantilla }, perfil).errores;
    expect(e.some((h) => h.regla === 'cuerpo' && /plantilla/.test(h.mensaje))).toBe(true);
    expect(informe({ ...bueno, cuerpo: plantilla }, perfil).avisos.some((h) => /Falta la sección "## Trazabilidad"/.test(h.mensaje))).toBe(true);
  });

  it('avisa (sin bloquear) cuando los campos de trazabilidad están vacíos', () => {
    const c = { ...bueno, cuerpo: bueno.cuerpo.replace('RF-BFA-GEN-03', '') };
    const i = informe(c, perfil);
    expect(i.avisos.some((h) => /RF \/ RNF/.test(h.mensaje))).toBe(true);
    expect(i.errores.some((h) => /RF \/ RNF/.test(h.mensaje))).toBe(false);
    expect(i.ok).toBe(true);
  });

  it('avisa sobre ≈400 líneas y bloquea sobre el máximo', () => {
    const grande = (n: number): Cambio => ({ ...bueno, archivos: [{ ruta: 'backend/A.java', estado: 'A', adiciones: n, eliminaciones: 0 }] });
    expect(informe(grande(450), perfil).avisos.some((h) => h.regla === 'tamano')).toBe(true);
    expect(informe(grande(450), perfil).ok).toBe(true);
    expect(informe(grande(800), perfil).ok).toBe(false);
  });

  it('detecta .env, .md nuevo fuera de docs y migraciones mal nombradas o editadas', () => {
    const c: Cambio = {
      ...bueno,
      archivos: [
        { ruta: 'backend/.env', estado: 'A', adiciones: 1, eliminaciones: 0 },
        { ruta: 'backend/NOTAS.md', estado: 'A', adiciones: 1, eliminaciones: 0 },
        { ruta: 'database/migrations/V1__mala.sql', estado: 'A', adiciones: 1, eliminaciones: 0 },
        { ruta: 'database/migrations/V202611060553__bfa_tabla.sql', estado: 'M', adiciones: 1, eliminaciones: 0 },
      ],
    };
    const mensajes = informe(c, perfil).errores.map((h) => h.mensaje).join('|');
    expect(mensajes).toMatch(/\.env/);
    expect(mensajes).toMatch(/\.md nuevo/);
    expect(mensajes).toMatch(/Nombre de migración inválido/);
    expect(mensajes).toMatch(/No se modifican ni borran/);
  });

  it('pide testing-ok solo a código GEN o BFA que no sea -TEST ni -INT', () => {
    const conEtiquetas = (titulo: string, rama: string, etiquetas: string[]): Cambio => ({ ...bueno, titulo, rama, etiquetas });
    const faltaTesting = (c: Cambio) => informe(c, perfil).avisos.some((h) => h.regla === 'testing');
    expect(faltaTesting(conEtiquetas('[GEN-01-BE] x', 'feature/a-GEN-01-BE', []))).toBe(true);
    expect(faltaTesting(conEtiquetas('[GEN-01-BE] x', 'feature/a-GEN-01-BE', ['testing-ok']))).toBe(false);
    expect(faltaTesting(conEtiquetas('[INT-02] x', 'feature/a-INT-02', []))).toBe(false);
    expect(faltaTesting(conEtiquetas('[GEN-01-TEST] x', 'test/a-GEN-01-TEST', []))).toBe(false);
  });
});
