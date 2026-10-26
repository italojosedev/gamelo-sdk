import { defineConfig } from 'tsup';

// Os pacotes @live/* (motor) entram no arquivo: quem instala o SDK não precisa do monorepo.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'es2022',
    dts: true,
    sourcemap: true,
    noExternal: [/^@live\//],
  },
  {
    // <script src=".../gamelo-sdk.iife.js"> para jogos sem bundler: window.GameloSDK.createLive()
    entry: { 'gamelo-sdk': 'src/index.ts' },
    format: ['iife'],
    globalName: 'GameloSDK',
    target: 'es2022',
    minify: true,
    noExternal: [/^@live\//],
    outExtension: () => ({ js: '.iife.js' }),
  },
]);
