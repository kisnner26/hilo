import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buscarActualizacion, compararVersiones, elegirAsset, entreComillas, scriptReemplazoAppImage, scriptReemplazoMac, urlDeConfianza } from '../src/index.js';

const assets = ['Hilo-0.2.0-arm64-mac.zip', 'Hilo-0.2.0-arm64.dmg', 'Hilo-0.2.0-win.zip', 'Hilo-0.2.0.AppImage', 'Hilo.Setup.0.2.0.exe'].map((nombre) => ({ nombre, url: `https://github.com/kisnner26/hilo/releases/download/v0.2.0/${nombre}`, tam: 100 }));

describe('versiones', () => {
  it('compara números, no texto', () => {
    expect(compararVersiones('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compararVersiones('v0.2.0', '0.1.99')).toBeGreaterThan(0);
    expect(compararVersiones('0.1.3', 'v0.1.3')).toBe(0);
    expect(compararVersiones('0.1.3', '0.1.3.1')).toBeLessThan(0);
    expect(compararVersiones('1.0.0-beta', '0.9.9')).toBeGreaterThan(0);
  });
});

describe('qué archivo bajar', () => {
  it('elige el de cada sistema', () => {
    expect(elegirAsset(assets, 'darwin', 'arm64')?.nombre).toBe('Hilo-0.2.0-arm64-mac.zip');
    expect(elegirAsset(assets, 'win32', 'x64')?.nombre).toBe('Hilo.Setup.0.2.0.exe');
    expect(elegirAsset(assets, 'linux', 'x64')?.nombre).toBe('Hilo-0.2.0.AppImage');
    expect(elegirAsset(assets, 'darwin', 'x64')).toBeUndefined();
    expect(elegirAsset(assets, 'freebsd', 'x64')).toBeUndefined();
  });
  it('solo confía en archivos del repositorio de Hilo', () => {
    expect(urlDeConfianza(assets[0]!.url)).toBe(true);
    expect(urlDeConfianza('https://evil.example/releases/download/x.zip')).toBe(false);
    expect(urlDeConfianza('https://github.com/otro/hilo/releases/download/v1/x.zip')).toBe(false);
  });
});

describe('buscar actualización', () => {
  const release = { tag_name: 'v0.2.0', body: 'Novedades', html_url: 'https://github.com/kisnner26/hilo/releases/tag/v0.2.0', published_at: '2026-11-25T00:00:00Z', assets: assets.map((a) => ({ name: a.nombre, browser_download_url: a.url, size: a.tam })) };
  const falso = (status: number, cuerpo: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });

  it('avisa cuando hay una versión más nueva y trae su archivo', async () => {
    const u = await buscarActualizacion('0.1.3', 'darwin', 'arm64', falso(200, release));
    expect(u).toMatchObject({ hay: true, actual: '0.1.3', ultima: '0.2.0', notas: 'Novedades' });
    expect(u.asset?.nombre).toBe('Hilo-0.2.0-arm64-mac.zip');
  });
  it('dice que estás al día cuando la versión es la misma', async () => {
    expect((await buscarActualizacion('0.2.0', 'darwin', 'arm64', falso(200, release))).hay).toBe(false);
  });
  it('descarta un archivo que no viene del repositorio', async () => {
    const mala = { ...release, assets: [{ name: 'Hilo-0.2.0-arm64-mac.zip', browser_download_url: 'https://evil.example/Hilo-0.2.0-arm64-mac.zip', size: 1 }] };
    expect((await buscarActualizacion('0.1.3', 'darwin', 'arm64', falso(200, mala))).asset).toBeUndefined();
  });
  it('explica los errores sin jerga', async () => {
    await expect(buscarActualizacion('0.1.3', 'darwin', 'arm64', falso(404, {}))).rejects.toThrow('Todavía no hay versiones');
    await expect(buscarActualizacion('0.1.3', 'darwin', 'arm64', falso(403, {}))).rejects.toThrow('limitó');
  });
});

describe('scripts de reemplazo', () => {
  it('protege las rutas con comillas', () => {
    expect(entreComillas("a b/c'd")).toBe(`'a b/c'\\''d'`);
    const s = scriptReemplazoMac({ pid: 123, zip: "/tmp/x y/Hilo'.zip", destino: '/Users/a b/Applications/Hilo.app' });
    expect(s).toContain("'/Users/a b/Applications/Hilo.app'");
    expect(s).not.toContain('$(rm');
  });
  it('guarda la versión anterior y la restaura si falla', () => {
    const s = scriptReemplazoMac({ pid: 1, zip: '/z.zip', destino: '/Hilo.app' });
    expect(s).toContain("mv '/Hilo.app' '/Hilo.app.anterior'");
    expect(s).toContain("mv '/Hilo.app.anterior' '/Hilo.app'");
  });
  it('el de AppImage espera, reemplaza y reabre', () => {
    const s = scriptReemplazoAppImage({ pid: 9, nuevo: '/t/n.AppImage', destino: '/o/Hilo.AppImage' });
    expect(s).toContain('kill -0 9');
    expect(s).toContain("mv -f '/t/n.AppImage' '/o/Hilo.AppImage'");
  });

  it.runIf(process.platform === 'darwin')('reemplaza una app de verdad, deja la nueva y borra la anterior', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'hilo-act-'));
    const hacerApp = (dir: string, version: string) => {
      mkdirSync(join(dir, 'Hilo.app/Contents'), { recursive: true });
      writeFileSync(join(dir, 'Hilo.app/Contents/version.txt'), version);
    };
    hacerApp(join(raiz, 'instalada'), '0.1.3');
    hacerApp(join(raiz, 'nueva'), '0.2.0');
    const zip = join(raiz, 'Hilo.zip');
    execFileSync('ditto', ['-c', '-k', '--keepParent', join(raiz, 'nueva/Hilo.app'), zip]);
    const destino = join(raiz, 'instalada/Hilo.app');
    // El proceso 99999999 no existe: el script no espera.
    const sh = join(raiz, 'r.sh');
    writeFileSync(sh, scriptReemplazoMac({ pid: 99_999_999, zip, destino }).replace(/open '[^']*'/g, 'true'));
    execFileSync('sh', [sh]);
    expect(readFileSync(join(destino, 'Contents/version.txt'), 'utf8')).toBe('0.2.0');
    expect(existsSync(`${destino}.anterior`)).toBe(false);
    expect(existsSync(zip)).toBe(false);
  });
});
