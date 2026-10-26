// Jogos do SDK: a lógica roda no navegador (no overlay do publisher), então o
// servidor só aplica o mapa de interações do game.json e repassa tudo como
// GameEvents. Mesmo protocolo dos jogos do motor, sem código de terceiros aqui.
import type { AudienceKind } from '@live/core';
import type { GameManifest, InteractionRule, Phase, RemoteManifest } from './manifest.ts';
import { summarize, type GameDefinition } from './runtime.ts';

const KINDS: AudienceKind[] = ['chat', 'gift', 'like', 'follow', 'share', 'join'];
const PHASES: Phase[] = ['lobby', 'countdown', 'playing', 'result'];

/** Rodada padrão de um jogo do SDK: sem lobby, contagem de 3 s e partida de 5 min. */
export const SDK_ROUND = { lobbySec: 0, countdownSec: 3, durationSec: 300, resultSec: 5 };

export class ManifestError extends Error {}

const sec = (v: unknown, fallback: number, field: string) => {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 31 * 24 * 3600) throw new ManifestError(`round.${field} deve ser um número de segundos`);
  return v;
};

/**
 * Confere o game.json de um jogo do SDK e preenche os padrões. Erros vêm em
 * português, prontos para mostrar ao publisher.
 */
export function parseManifest(raw: unknown, fallbackId = 'jogo'): GameManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ManifestError('game.json deve ser um objeto');
  const m = raw as Record<string, unknown>;
  const round = (m.round ?? {}) as Record<string, unknown>;
  if (typeof round !== 'object' || Array.isArray(round)) throw new ManifestError('round deve ser um objeto');
  const rules = m.interactions ?? [];
  if (!Array.isArray(rules)) throw new ManifestError('interactions deve ser uma lista');
  const interactions = rules.map((r, i) => checkRule(r, i));
  const settings = m.settings ?? {};
  if (typeof settings !== 'object' || Array.isArray(settings)) throw new ManifestError('settings deve ser um objeto');
  const remote = checkRemote(m.remote);
  const id = typeof m.id === 'string' && /^[\w-]{1,64}$/.test(m.id) ? m.id : fallbackId;
  return {
    ...(m as object),
    id,
    name: typeof m.name === 'string' && m.name.trim() ? m.name : id,
    aspect: m.aspect === '16:9' ? '16:9' : '9:16',
    round: {
      lobbySec: sec(round.lobbySec, SDK_ROUND.lobbySec, 'lobbySec'),
      countdownSec: sec(round.countdownSec, SDK_ROUND.countdownSec, 'countdownSec'),
      durationSec: sec(round.durationSec, SDK_ROUND.durationSec, 'durationSec'),
      resultSec: sec(round.resultSec, SDK_ROUND.resultSec, 'resultSec'),
    },
    interactions,
    settings: settings as Record<string, unknown>,
    ...(remote ? { remote } : { remote: undefined }),
  } as GameManifest;
}

/** Caminho de um arquivo do build: relativo, sem "..", sem barra no começo. */
export function safeBuildPath(path: string): boolean {
  return /^[\w][\w ./-]*\.html?$/i.test(path) && !path.split('/').includes('..') && path.length <= 200;
}

function checkRemote(raw: unknown): RemoteManifest | null {
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ManifestError('remote deve ser um objeto, ex.: { "page": "controle.html" }');
  const r = raw as Record<string, unknown>;
  if (typeof r.page !== 'string' || !safeBuildPath(r.page.replace(/^\.\//, ''))) {
    throw new ManifestError('remote.page deve ser o caminho de uma página .html do build (ex.: "controle.html")');
  }
  if (r.qr !== undefined && typeof r.qr !== 'boolean') throw new ManifestError('remote.qr deve ser true ou false');
  if (r.label !== undefined && (typeof r.label !== 'string' || r.label.length > 30)) throw new ManifestError('remote.label deve ser um texto de até 30 letras');
  return { page: r.page.replace(/^\.\//, ''), ...(r.qr !== undefined ? { qr: r.qr } : {}), ...(typeof r.label === 'string' && r.label.trim() ? { label: r.label.trim() } : {}) };
}

function checkRule(raw: unknown, i: number): InteractionRule {
  const where = `interactions[${i}]`;
  if (!raw || typeof raw !== 'object') throw new ManifestError(`${where} deve ser um objeto`);
  const r = raw as InteractionRule;
  if (!KINDS.includes(r.on)) throw new ManifestError(`${where}.on deve ser um de: ${KINDS.join(', ')}`);
  if (typeof r.action !== 'string' || !r.action.trim()) throw new ManifestError(`${where}.action é obrigatório`);
  if (r.match !== undefined) {
    if (typeof r.match !== 'string') throw new ManifestError(`${where}.match deve ser texto`);
    try {
      new RegExp(r.match, 'i');
    } catch {
      throw new ManifestError(`${where}.match não é uma expressão regular válida`);
    }
  }
  if (r.keywords !== undefined && (!Array.isArray(r.keywords) || !r.keywords.every((k) => typeof k === 'string'))) {
    throw new ManifestError(`${where}.keywords deve ser uma lista de textos`);
  }
  if (r.gift !== undefined && typeof r.gift !== 'string' && !(Array.isArray(r.gift) && r.gift.every((g) => typeof g === 'string'))) {
    throw new ManifestError(`${where}.gift deve ser um nome ou uma lista de nomes`);
  }
  if (r.minCoins !== undefined && (typeof r.minCoins !== 'number' || r.minCoins < 0)) throw new ManifestError(`${where}.minCoins deve ser um número >= 0`);
  if (r.cooldownMs !== undefined && (typeof r.cooldownMs !== 'number' || r.cooldownMs < 0)) throw new ManifestError(`${where}.cooldownMs deve ser um número >= 0`);
  if (r.phases !== undefined && (!Array.isArray(r.phases) || !r.phases.every((p) => PHASES.includes(p)))) {
    throw new ManifestError(`${where}.phases deve listar fases entre: ${PHASES.join(', ')}`);
  }
  return r;
}

/**
 * Jogo do SDK no servidor: cada regra do mapa de interações que casar vira um
 * GameEvent "action" com o evento original. A rodada (lobby → contagem →
 * partida → resultado) continua no servidor, igual para todos os overlays.
 */
export function sdkGame(manifest: GameManifest): GameDefinition<Record<string, never>> {
  return {
    manifest,
    init: () => ({}),
    onAction(_state, action, ctx) {
      ctx.emit('action', {
        name: action.name,
        params: action.params,
        viewer: action.viewer,
        amount: action.amount,
        coins: action.coins,
        event: summarize(action.source),
      });
    },
    view: () => ({}),
  };
}
