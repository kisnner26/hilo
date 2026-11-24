// Compila los ayudantes nativos de macOS: dictado por voz, IA local de Apple Intelligence y lectura de imágenes y PDF.
// En otros sistemas no hace nada: allí se usa el dictado del sistema y, para IA local, Ollama.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const AYUDANTES = [
  { fuente: 'dictado.swift', salida: 'hilo-dictado', marcos: ['Speech', 'AVFoundation'] },
  { fuente: 'hilo-ia.swift', salida: 'hilo-ia', marcos: ['FoundationModels'] },
  { fuente: 'hilo-ocr.swift', salida: 'hilo-ocr', marcos: ['Vision', 'PDFKit', 'AppKit'] },
];
mkdirSync(join(raiz, 'native/bin'), { recursive: true });
for (const a of AYUDANTES) {
  try {
    execFileSync('swiftc', ['-O', '-swift-version', '5', join(raiz, 'native', a.fuente), '-o', join(raiz, 'native/bin', a.salida), ...a.marcos.flatMap((m) => ['-framework', m])], { stdio: 'inherit' });
    console.log(`compilado: native/bin/${a.salida}`);
  } catch (e) {
    // Si el equipo de compilación no trae ese marco (macOS antiguo), se omite: la app lo detecta y no ofrece esa función.
    console.warn(`No se pudo compilar ${a.salida}; se omite:`, e instanceof Error ? e.message : e);
  }
}
