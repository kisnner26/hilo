// Compila el ayudante de dictado de macOS. En otros sistemas no hace nada: allí el dictado es el del propio sistema.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  mkdirSync(join(raiz, 'native/bin'), { recursive: true });
  execFileSync('swiftc', ['-O', '-swift-version', '5', join(raiz, 'native/dictado.swift'), '-o', join(raiz, 'native/bin/hilo-dictado'), '-framework', 'Speech', '-framework', 'AVFoundation'], { stdio: 'inherit' });
  console.log('dictado compilado: native/bin/hilo-dictado');
} catch (e) {
  console.warn('No se pudo compilar el dictado; se omite:', e instanceof Error ? e.message : e);
}
