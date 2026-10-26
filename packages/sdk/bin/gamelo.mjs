#!/usr/bin/env node
// gamelo: cria um jogo novo, empacota o build em .zip e envia para a Gamelo.
//
//   npx @gamelo/sdk init meu-jogo      cria a pasta com o exemplo, as regras e a skill para IA
//   gamelo pack                            dist/ + game.json + demo.json → game.zip
//   gamelo deploy                          pack + envia como build novo (LIVE_TOKEN e LIVE_ENGINE)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, ...rest] = process.argv.slice(2);

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}

function fail(msg) {
  console.error(`gamelo: ${msg}`);
  process.exit(1);
}

/** Lê .env.local / .env da pasta para LIVE_TOKEN e LIVE_ENGINE (aceita também os nomes VITE_). */
function env(name) {
  if (process.env[name]) return process.env[name];
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:VITE_)?([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] === name && m[2]) return m[2].replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

function init() {
  const name = rest.find((a) => !a.startsWith('--')) ?? 'meu-jogo-live';
  const target = resolve(name);
  if (existsSync(target) && readdirSync(target).length) fail(`a pasta ${name} já existe e não está vazia`);
  mkdirSync(target, { recursive: true });
  cpSync(join(pkgDir, 'template'), target, { recursive: true });
  renameSync(join(target, '_gitignore'), join(target, '.gitignore'));
  // Regras e skill para desenvolver com IA (Claude Code, Cursor, Codex…).
  cpSync(join(pkgDir, 'AGENTS.md'), join(target, 'AGENTS.md'));
  writeFileSync(join(target, 'CLAUDE.md'), '@AGENTS.md\n');
  cpSync(join(pkgDir, 'skill', 'live-game'), join(target, '.claude', 'skills', 'live-game'), { recursive: true });
  cpSync(join(pkgDir, 'EVENTS.md'), join(target, 'docs', 'EVENTS.md'));
  const pkgPath = join(target, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  pkg.dependencies['@gamelo/sdk'] = `^${JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version}`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`Pronto: ${relative(process.cwd(), target) || '.'}

  cd ${name}
  npm install
  npm run dev          # roda com público simulado
  # para usar a sala do motor: copie .env.example para .env.local e cole o token do jogo
  npm run deploy       # build + envia uma versão nova para o painel`);
}

function pack() {
  const dir = resolve(flag('dir', 'dist'));
  const out = resolve(flag('out', 'game.zip'));
  if (!existsSync(join(dir, 'index.html'))) fail(`não achei ${relative(process.cwd(), dir)}/index.html. Rode o build antes (npm run build).`);
  const files = {};
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(dir, full).split('\\').join('/')] = new Uint8Array(readFileSync(full));
    }
  })(dir);
  // game.json (regras) e demo.json (eventos do preview) vão na raiz do zip; os dois são obrigatórios.
  for (const name of ['game.json', 'demo.json']) {
    if (files[name]) continue;
    const fallback = [`public/${name}`, name].find((f) => existsSync(f));
    if (!fallback) fail(`falta o ${name} (coloque em public/${name})`);
    files[name] = new Uint8Array(readFileSync(fallback));
  }
  try {
    const manifest = JSON.parse(new TextDecoder().decode(files['game.json']));
    if (!Array.isArray(manifest.interactions ?? [])) fail('game.json: interactions deve ser uma lista');
  } catch (err) {
    fail(`game.json inválido: ${err.message}`);
  }
  try {
    const demo = JSON.parse(new TextDecoder().decode(files['demo.json']));
    if (!Array.isArray(demo.events) || !demo.events.length) fail('demo.json: events deve ter pelo menos um evento');
  } catch (err) {
    fail(`demo.json inválido: ${err.message}`);
  }
  const mtime = new Date('2026-01-01T00:00:00Z');
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([p, d]) => [p, [d, { mtime }]])), { level: 9 });
  writeFileSync(out, zip);
  console.log(`${relative(process.cwd(), out)}: ${Object.keys(files).length} arquivos, ${(zip.length / 1024).toFixed(0)} KB`);
  return out;
}

async function deploy() {
  const token = flag('token', env('LIVE_TOKEN'));
  const engine = flag('engine', env('LIVE_ENGINE'));
  if (!token || !engine) fail('defina LIVE_TOKEN e LIVE_ENGINE (ou VITE_LIVE_TOKEN e VITE_LIVE_ENGINE no .env.local), ou passe --token e --engine');
  const zipPath = pack();
  const form = new FormData();
  form.set('bundle', new Blob([readFileSync(zipPath)], { type: 'application/zip' }), 'game.zip');
  form.set('notes', flag('notes', ''));
  const res = await fetch(new URL('/sdk/builds', engine), { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(Array.isArray(data.message) ? data.message.join('; ') : (data.message ?? `erro ${res.status}`));
  console.log(`Versão ${data.version} enviada. Peça a revisão no painel do publisher quando quiser publicar.`);
}

switch (cmd) {
  case 'init':
    init();
    break;
  case 'pack':
    pack();
    break;
  case 'deploy':
    await deploy();
    break;
  default:
    console.log(`gamelo <comando>

  init [pasta]                  cria um jogo novo a partir do exemplo
  pack [--dir dist] [--out game.zip]
  deploy [--notes "o que mudou"] [--token lg_...] [--engine https://api...]`);
    if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
}
