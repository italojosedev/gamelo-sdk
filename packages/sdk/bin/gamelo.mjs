#!/usr/bin/env node
// gamelo: cria um jogo novo, empacota o build em .zip e envia para a Gamelo.
//
//   npx @gamelo/sdk init meu-jogo      cria a pasta com o exemplo, as regras e a skill para IA
//   gamelo pack                            dist/ + game.json + demo.json → game.zip
//   gamelo deploy                          pack + envia como versão nova (token de publicação)
//   gamelo builds                          lista as versões enviadas e a revisão de cada uma
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

/** Lê uma variável do ambiente ou do .env.local / .env da pasta (aceita também o nome com VITE_). */
function env(name) {
  if (process.env[name]) return process.env[name];
  if (process.env[`VITE_${name}`]) return process.env[`VITE_${name}`];
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(VITE_)?([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || m[2] !== name || !m[3]) continue;
      // Com VITE_ o Vite põe o valor no build, que vai para a loja.
      if (m[1] && name === 'GAMELO_PUBLISH_TOKEN') fail(`tire o VITE_ de VITE_GAMELO_PUBLISH_TOKEN no ${file}: com ele o token de publicação vai junto no build do jogo`);
      return m[3].replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

/** Cliente da API com o token de publicação (gamelo deploy, gamelo builds). */
async function publishApi() {
  const token = flag('token', env('GAMELO_PUBLISH_TOKEN'));
  if (!token) fail('falta o token de publicação: coloque GAMELO_PUBLISH_TOKEN=lgp_... no .env.local (página do jogo no painel do publisher) ou passe --token');
  if (token.startsWith('lgt_')) fail('esse é o token de teste; para enviar versões use o token de publicação (lgp_...)');
  const { createApi } = await import('../dist/api.js');
  return createApi({ token, engine: flag('engine', env('GAMELO_API')) });
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
  cp .env.example .env.local   # cole os tokens do jogo (painel do publisher)
  npm run dev          # sala de teste da Gamelo com público simulado
  npm run deploy       # build + envia uma versão nova (token de publicação)`);
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
  const api = await publishApi();
  const zipPath = pack();
  try {
    const build = await api.uploadBuild(new Uint8Array(readFileSync(zipPath)), flag('notes', ''));
    console.log(`Versão ${build.version} enviada. Prévia: ${build.previewUrl}
Peça a revisão no painel do publisher quando quiser publicar.`);
  } catch (err) {
    fail(err.message);
  }
}

async function builds() {
  const api = await publishApi();
  try {
    const list = await api.builds();
    if (!list.length) return console.log('Nenhuma versão enviada ainda.');
    const status = { uploaded: 'enviada', approved: 'aprovada', rejected: 'recusada' };
    for (const b of list) {
      const when = new Date(b.createdAt).toLocaleString('pt-BR');
      console.log(`${b.current ? '*' : ' '} ${b.version.padEnd(5)} ${status[b.status].padEnd(9)} ${when}  ${b.notes || ''}${b.reviewNotes ? `  (revisão: ${b.reviewNotes})` : ''}`);
    }
    console.log('\n* versão atual, a que os streamers usam');
  } catch (err) {
    fail(err.message);
  }
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
  case 'builds':
    await builds();
    break;
  default:
    console.log(`gamelo <comando>

  init [pasta]                  cria um jogo novo a partir do exemplo
  pack [--dir dist] [--out game.zip]
  deploy [--notes "o que mudou"] [--token lgp_...] [--engine https://api...]
  builds [--token lgp_...]      versões enviadas e a revisão de cada uma`);
    if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
}
