import { giftValue, type AudienceEvent, type AudienceKind } from '@live/core';

export type Phase = 'lobby' | 'countdown' | 'playing' | 'result';

/**
 * Regra do mapa de interações (editável pelo streamer, sem código).
 * Ex.: { on: 'gift', gift: 'Rose', action: 'attack', params: { power: 1 } }
 */
export interface InteractionRule {
  on: AudienceKind;
  action: string;
  /** chat: regex (sem diferenciar maiúsculas) que o comentário inteiro precisa casar. */
  match?: string;
  /** chat: qualquer uma destas palavras como comentário inteiro. */
  keywords?: string[];
  /**
   * gift: nome ou id do presente (ou uma lista deles, ex.: nome em inglês, em
   * português e o id). Tem prioridade sobre faixas de preço.
   */
  gift?: string | string[];
  /** gift: faixa de preço. A regra com o maior minCoins atingido vence. */
  minCoins?: number;
  /** Fases em que a regra vale. Padrão: só durante a partida. */
  phases?: Phase[];
  /** Cooldown da regra por espectador. */
  cooldownMs?: number;
  params?: Record<string, unknown>;
  enabled?: boolean;
  /** Nome da regra no painel (ex.: "Voto em Barreira de Fogo"). */
  label?: string;
  /** chat: comentário de exemplo, usado nos botões de teste do painel. */
  example?: string;
}

/** Como um ajuste aparece no painel do streamer. */
export interface SettingInfo {
  label: string;
  /** Valores possíveis, para virar uma lista de escolha. */
  options?: { value: string | number; label: string }[];
}

export interface RoundConfig {
  /** Tempo de espera entre rodadas (entrada de jogadores). 0 pula o lobby. */
  lobbySec: number;
  countdownSec: number;
  /** Duração máxima da partida. O jogo pode encerrar antes. */
  durationSec: number;
  resultSec: number;
}

export interface GameManifest {
  id: string;
  name: string;
  aspect: '9:16' | '16:9';
  round: RoundConfig;
  interactions: InteractionRule[];
  /** Ajustes livres do jogo (vida do chefe, nº de lados...), expostos no painel. */
  settings?: Record<string, unknown>;
  /** Nome e opções de cada ajuste no painel. Ajustes sem entrada aqui aparecem pelo nome da chave. */
  settingsInfo?: Record<string, SettingInfo>;
  /** Como o simulador imita a audiência deste jogo (comentários e presentes). */
  simulator?: {
    messages?: string[];
    gifts?: { name: string; coins: number; weight: number }[];
  };
}

function giftMatches(rule: InteractionRule, e: { giftName: string; giftId: string }): boolean {
  if (!rule.gift) return false;
  const names = Array.isArray(rule.gift) ? rule.gift : [rule.gift];
  const name = e.giftName.toLowerCase();
  return names.some((g) => g.toLowerCase() === name || g === e.giftId);
}

/** Escolhe a regra que vale para um evento, ou null. */
export function matchRule(rules: InteractionRule[], e: AudienceEvent, phase: Phase): InteractionRule | null {
  const live = rules.filter((r) => r.enabled !== false && r.on === e.kind && (r.phases ?? ['playing']).includes(phase));
  if (e.kind === 'chat') {
    const text = e.text.trim();
    return (
      live.find((r) => {
        if (r.keywords) return r.keywords.some((k) => k.toLowerCase() === text.toLowerCase());
        if (r.match) return new RegExp(r.match, 'i').test(text);
        return true;
      }) ?? null
    );
  }
  if (e.kind === 'gift') {
    const named = live.find((r) => giftMatches(r, e));
    if (named) return named;
    // Faixas de preço: o degrau mais alto que o presente alcança, para o barato não "roubar" o efeito do caro.
    const value = e.coins;
    let best: InteractionRule | null = null;
    for (const r of live) {
      if (r.gift) continue;
      const min = r.minCoins ?? 0;
      if (value >= min && (!best || min > (best.minCoins ?? 0))) best = r;
    }
    return best ?? null;
  }
  return live[0] ?? null;
}

export function amountOf(e: AudienceEvent): number {
  if (e.kind === 'gift' || e.kind === 'like') return e.count;
  return 1;
}

export function coinsOf(e: AudienceEvent): number {
  return e.kind === 'gift' ? giftValue(e) : 0;
}
