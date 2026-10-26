import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // index: jogo e página de controle (navegador). api: cliente da API da Gamelo, também no Node (CLI, scripts).
    entry: { index: 'src/index.ts', api: 'src/api.ts' },
    format: ['esm'],
    target: 'es2022',
    dts: true,
    sourcemap: true,
  },
  {
    // <script src=".../gamelo-sdk.iife.js"> para jogos sem bundler: window.GameloSDK.createLive()
    entry: { 'gamelo-sdk': 'src/index.ts' },
    format: ['iife'],
    globalName: 'GameloSDK',
    target: 'es2022',
    minify: true,
    outExtension: () => ({ js: '.iife.js' }),
  },
]);
