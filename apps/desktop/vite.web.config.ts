import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Solo el renderizador, en el navegador y con datos de demostración. Sirve para ver y probar la interfaz. */
export default defineConfig({ root: resolve(import.meta.dirname, 'src/renderer'), plugins: [react()], server: { port: 5199, strictPort: true } });
