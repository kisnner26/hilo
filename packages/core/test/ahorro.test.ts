import { describe, expect, it } from 'vitest';
import { comprimirSalida, estimarTokens, extractoRelevante, medirAhorro, nuevoHilo, conPaso, paqueteDeContexto, promptDeRol, resumenEstatico, sesionNueva, cargarPerfil, type Grafo } from '../src/index.js';
import { join } from 'node:path';

const g: Grafo = {
  nodos: [
    ...Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, label: `ServicioA${i}`, archivo: `backend/src/A${i}.java`, comunidad: 0, nombreComunidad: 'domain/model' })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, label: `Pantalla${i}`, archivo: `frontend/src/B${i}.tsx`, comunidad: 1, nombreComunidad: 'features/catalog' })),
    { id: 'c', label: 'ci', archivo: '.github/ci.yml', comunidad: 2, nombreComunidad: 'ruido' },
  ],
  enlaces: Array.from({ length: 39 }, (_, i) => ({ origen: 'a0', destino: `a${i + 1}`, relacion: 'usa' })),
};

describe('ahorro de tokens', () => {
  it('el resumen estático es corto, nombra comunidades y deja fuera el ruido', () => {
    const r = resumenEstatico(g, { porComunidad: 2 });
    expect(r).toContain('domain/model (40): ServicioA0');
    expect(r).toContain('features/catalog (20)');
    expect(r).not.toContain('ruido');
    expect(estimarTokens(r)).toBeLessThan(estimarTokens(g.nodos.map((n) => n.label).join('\n')) / 3);
  });

  it('mide cuánto se ahorra frente a mandar todo el grafo', () => {
    const p = paqueteDeContexto(g, { alcance: { tipo: 'vecindad', nodo: 'b3', saltos: 1 }, conciso: true, sinRuido: true, presupuesto: 500 });
    const a = medirAhorro(g, p);
    expect(a.tokensTodo).toBeGreaterThan(a.tokens);
    expect(a.ahorro).toBeGreaterThan(0.5);
  });

  it('comprime la salida de una terminal: sin color ni barras, repetidos juntos, errores a la vista', () => {
    const crudo = ['\u001b[32mBuilding\u001b[0m', ...Array(5).fill('npm warn deprecated glob@7'), '50%', ...Array(40).fill('compilando módulo'), '[ERROR] Spotless violations in A.java', ...Array.from({ length: 60 }, (_, i) => `linea ${i}`), 'BUILD FAILURE'].join('\n');
    const c = comprimirSalida(crudo, 30);
    expect(c).not.toContain('\u001b');
    expect(c).toContain('[ERROR] Spotless violations');
    expect(c).toContain('BUILD FAILURE');
    expect(c.split('\n').length).toBeLessThan(45);
    expect(comprimirSalida('igual\nigual\nigual')).toBe('igual (x3)');
  });

  it('de una nota larga trae solo los párrafos que tocan la consulta', () => {
    const nota = ['# Plan', 'Introducción sin relación con nada.', 'El #41 cambia los ids a Long porque el contrato define int64.', 'Otro párrafo de relleno sobre despliegue y secretos.', 'Las migraciones no se editan.'].join('\n\n');
    const e = extractoRelevante(nota, 'ids Long contrato', 200);
    expect(e).toContain('ids a Long');
    expect(e).not.toContain('relleno');
    expect(e.length).toBeLessThanOrEqual(260);
  });

  it('la sesión nueva lleva reglas, resumen y el hilo, y no el proyecto entero', () => {
    const h = conPaso(nuevoHilo('x', 'desarrollador', 'pruebas de R1', 'BFA-BE-04'), 'abrir PR en borrador');
    const t = sesionNueva(h, resumenEstatico(g), 'Reglas fijas.');
    expect(t.startsWith('Reglas fijas.')).toBe(true);
    expect(t).toContain('pruebas de R1');
    expect(t).toContain('Retoma desde "Falta"');
    expect(t).not.toContain('ServicioA39');
  });

  it('el estilo breve se agrega solo cuando se pide', () => {
    const p = cargarPerfil(join(import.meta.dirname, '../../../profiles/sistema-evaluaciones.json'));
    expect(promptDeRol('tester', p, 'breve')).toContain('Responde corto');
    expect(promptDeRol('tester', p)).not.toContain('Responde corto');
  });
});

describe('paquete a la medida con varios nodos fijados', () => {
  const nodo = (id: string) => ({ id, label: id, archivo: `src/${id}.ts`, comunidad: 1, nombreComunidad: 'c' });
  const g = { nodos: ['A', 'B', 'C', 'D', 'E'].map(nodo), enlaces: [{ origen: 'A', destino: 'B', relacion: 'usa' }, { origen: 'D', destino: 'E', relacion: 'usa' }] };
  it('junta solo las vecindades de lo fijado y deja fuera el resto', () => {
    const p = paqueteDeContexto(g, { alcance: { tipo: 'nodos', ids: ['A', 'D'], saltos: 1 }, conciso: true, sinRuido: true, presupuesto: 1000 });
    expect(p.nodos).toBe(4);
    expect(p.texto).not.toContain('- C ');
  });
});
