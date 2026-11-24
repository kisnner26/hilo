import { describe, expect, it } from 'vitest';
import { custodiarMigraciones, siguienteVersion, versionDe } from '../src/index.js';

const patron = /^V[0-9]{12}__[a-z0-9]+_[a-z0-9_]+\.sql$/;
const main = ['V202611040249__comun_catalogo_versionado.sql', 'V202611170600__comun_agregar_factor_subprueba.sql'];

describe('custodio de migraciones', () => {
  it('suma un minuto respetando horas, días y meses', () => {
    expect(siguienteVersion('202611240159')).toBe('202611240200');
    expect(siguienteVersion('202611302359')).toBe('202612010000');
    expect(siguienteVersion('202612312359')).toBe('202701010000');
  });

  it('deja pasar lo que está bien nombrado y en orden', () => {
    expect(custodiarMigraciones(main, [{ pr: 89, nombres: ['V202611240156__comun_cuenta_y_sesion.sql'] }], patron)).toEqual([]);
  });

  it('detecta una versión anterior a la última de main y propone una nueva', () => {
    const r = custodiarMigraciones(main, [{ pr: 69, nombres: ['V202611120930__bfa_baremos.sql'] }], patron);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ pr: 69, nuevoNombre: 'V202611170601__bfa_baremos.sql' });
    expect(r[0]!.problema).toContain('no es posterior');
  });

  it('el orden de fusión decide: lo que entra después debe ser posterior a lo que entra antes', () => {
    const r = custodiarMigraciones(
      main,
      [
        { pr: 89, nombres: ['V202611240156__comun_cuenta_y_sesion.sql'] },
        { pr: 69, nombres: ['V202611190930__bfa_baremos.sql'] },
        { pr: 67, nombres: ['V202611190900__comun_opciones_esperadas.sql'] },
      ],
      patron,
    );
    expect(r.map((x) => [x.pr, x.nuevoNombre])).toEqual([
      [69, 'V202611240157__bfa_baremos.sql'],
      [67, 'V202611240158__comun_opciones_esperadas.sql'],
    ]);
  });

  it('conserva el orden relativo de las migraciones de un mismo PR', () => {
    const r = custodiarMigraciones(main, [{ pr: 41, nombres: ['V202611110001__comun_c.sql', 'V202611060553__comun_a.sql', 'V202611100001__comun_b.sql'] }], patron);
    expect(r.map((x) => x.nuevoNombre)).toEqual(['V202611170601__comun_a.sql', 'V202611170602__comun_b.sql', 'V202611170603__comun_c.sql']);
  });

  it('detecta versiones repetidas entre PR distintos', () => {
    const r = custodiarMigraciones(main, [{ pr: 1, nombres: ['V202611250000__comun_x.sql'] }, { pr: 2, nombres: ['V202611250000__comun_y.sql'] }], patron);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ pr: 2, nuevoNombre: 'V202611250001__comun_y.sql' });
    expect(r[0]!.problema).toContain('ya la usa');
  });

  it('un módulo que no existe se corrige a comun', () => {
    const r = custodiarMigraciones(main, [{ pr: 67, nombres: ['V202611250000__configuracion_opciones_esperadas.sql'] }], patron);
    expect(r[0]!.problema).toContain('módulo «configuracion»');
    expect(r[0]!.nuevoNombre).toBe('V202611250000__comun_configuracion_opciones_esperadas.sql');
  });

  it('un nombre que no cumple el formato se señala aunque no se pueda arreglar solo', () => {
    const r = custodiarMigraciones(main, [{ pr: 5, nombres: ['V1__mala.sql'] }], patron);
    expect(r[0]!.problema).toContain('no cumple');
    expect(versionDe('V1__mala.sql')).toBeUndefined();
  });
});
