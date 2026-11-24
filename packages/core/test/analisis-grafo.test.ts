import { describe, expect, it } from 'vitest';
import { buscarNodos, conexiones, dependencias, describir, impacto, puntosClave, rutaMasCorta, type GrafoG } from '../src/analisis-grafo.js';

const n = (id: string, extra: Partial<GrafoG['nodos'][number]> = {}) => ({ id, label: id, archivo: `src/${id}.ts`, comunidad: 1, nombreComunidad: 'servicios', ...extra });
const g: GrafoG = {
  nodos: [n('Controlador'), n('Servicio'), n('Repositorio'), n('Modelo'), n('Aislado'), n('Test'), n('java.util', { archivo: undefined })],
  enlaces: [
    { origen: 'Controlador', destino: 'Servicio', relacion: 'usa' },
    { origen: 'Servicio', destino: 'Repositorio', relacion: 'usa' },
    { origen: 'Servicio', destino: 'Modelo', relacion: 'usa' },
    { origen: 'Repositorio', destino: 'Modelo', relacion: 'usa' },
    { origen: 'Test', destino: 'Servicio', relacion: 'prueba' },
    { origen: 'Servicio', destino: 'java.util', relacion: 'importa' },
  ],
};

describe('análisis del grafo', () => {
  it('separa lo que un nodo usa de lo que lo usa, sin librerías externas', () => {
    const c = conexiones(g, 'Servicio');
    expect(c.sale.map((x) => x.nodo.id).sort()).toEqual(['Modelo', 'Repositorio']);
    expect(c.entra.map((x) => x.nodo.id).sort()).toEqual(['Controlador', 'Test']);
    expect(conexiones(g, 'Servicio', true).sale.map((x) => x.nodo.id)).toContain('java.util');
  });

  it('el impacto es todo lo que depende, directa e indirectamente, con su distancia', () => {
    const r = impacto(g, 'Modelo');
    expect(r.map((x) => [x.nodo.id, x.distancia]).sort()).toEqual([['Controlador', 2], ['Repositorio', 1], ['Servicio', 1], ['Test', 2]]);
    expect(impacto(g, 'Modelo', 1).map((x) => x.nodo.id).sort()).toEqual(['Repositorio', 'Servicio']);
    expect(impacto(g, 'Controlador')).toEqual([]);
  });

  it('las dependencias son lo que hay que entender para tocar algo', () => {
    expect(dependencias(g, 'Controlador').map((x) => x.nodo.id).sort()).toEqual(['Modelo', 'Repositorio', 'Servicio']);
  });

  it('encuentra el camino más corto en cualquier sentido', () => {
    const r = rutaMasCorta(g, 'Controlador', 'Modelo')!;
    expect(r.map((p) => p.nodo.id)).toEqual(['Controlador', 'Servicio', 'Modelo']);
    expect(r[1]!.relacion).toBe('usa');
    expect(rutaMasCorta(g, 'Modelo', 'Test')!.map((p) => p.nodo.id)).toEqual(['Modelo', 'Servicio', 'Test']);
  });

  it('dice que no hay camino cuando no lo hay', () => {
    expect(rutaMasCorta(g, 'Aislado', 'Modelo')).toBeUndefined();
    expect(rutaMasCorta(g, 'Nada', 'Modelo')).toBeUndefined();
  });

  it('busca sin tildes ni mayúsculas y pone primero lo que empieza igual', () => {
    expect(buscarNodos(g, 'serv')[0]!.id).toBe('Servicio');
    expect(buscarNodos(g, 'REPO').map((x) => x.id)).toEqual(['Repositorio']);
    expect(buscarNodos(g, 'x')).toEqual([]);
    expect(buscarNodos(g, 'java')).toEqual([]);
  });

  it('los puntos clave son los más usados', () => {
    expect(puntosClave(g, 2).map((x) => x.nodo.id)).toEqual(['Modelo', 'Servicio']);
  });

  it('describe un nodo en una frase con su alcance', () => {
    const d = describir(g, 'Modelo');
    expect(d).toContain('Lo usan 2');
    expect(d).toContain('puede alcanzar 4 nodos');
    expect(describir(g, 'Aislado')).toContain('Nada lo usa directamente');
  });
});
