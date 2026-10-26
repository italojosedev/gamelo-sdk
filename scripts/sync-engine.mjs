#!/usr/bin/env node
// Copia o motor (core, gateway, runtime, simulator) do repositório da plataforma para engine/.
// O modo local do SDK roda esse mesmo motor dentro da página, então as duas cópias precisam
// ficar iguais. Rode depois de mudar um desses pacotes no live-engine:
//
//   node scripts/sync-engine.mjs ../live-engine
//   node scripts/sync-engine.mjs ../live-engine --check   # só confere (falha se estiver diferente)
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const source = resolve(args.find((a) => !a.startsWith('--')) ?? '../live-engine');
const PACKAGES = ['core', 'gateway', 'runtime', 'simulator'];

if (!existsSync(join(source, 'packages', 'core', 'package.json'))) {
  console.error(`sync-engine: não achei o live-engine em ${source}`);
  process.exit(1);
}

function files(dir) {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      if (n === 'node_modules' || n === 'dist') continue;
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  })(dir);
  return out;
}

let diff = 0;
for (const name of PACKAGES) {
  const from = join(source, 'packages', name);
  const to = join(root, 'engine', name);
  if (check) {
    const a = files(from);
    const b = existsSync(to) ? files(to) : [];
    for (const f of new Set([...a, ...b])) {
      const x = existsSync(join(from, f)) ? readFileSync(join(from, f), 'utf8') : null;
      const y = existsSync(join(to, f)) ? readFileSync(join(to, f), 'utf8') : null;
      if (x !== y) {
        diff++;
        console.log(`diferente: engine/${name}/${f}`);
      }
    }
    continue;
  }
  // Apaga o que veio antes, menos o node_modules (os links do pnpm continuam valendo).
  if (existsSync(to)) for (const n of readdirSync(to)) if (n !== 'node_modules') rmSync(join(to, n), { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (p) => !/[\\/](node_modules|dist)([\\/]|$)/.test(p) });
  console.log(`engine/${name} ← ${relative(process.cwd(), from)}`);
}

if (check) {
  if (diff) {
    console.error(`sync-engine: ${diff} arquivo(s) diferentes. Rode sem --check para copiar.`);
    process.exit(1);
  }
  console.log('sync-engine: engine/ igual ao live-engine.');
}
