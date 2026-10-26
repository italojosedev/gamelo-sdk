import { defineConfig } from 'vite';

// Caminhos relativos: o build é servido de uma pasta qualquer do storage da Gamelo.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
