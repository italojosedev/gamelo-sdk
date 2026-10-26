import { describe, expect, it } from 'vitest';
import type { AudienceEvent } from '@live/core';
import { GameRuntime, matchRule, type GameDefinition, type GameManifest, type InteractionRule } from './index.ts';

const viewer = { id: 'v1', handle: 'ana', nickname: 'Ana' };
const gift = (giftName: string, coins: number): AudienceEvent => ({ kind: 'gift', id: giftName, platform: 'sim', viewer, at: 0, giftId: giftName, giftName, coins, count: 1, comboEnd: true });

describe('matchRule', () => {
  const rules: InteractionRule[] = [
    { on: 'gift', minCoins: 0, action: 'small' },
    { on: 'gift', minCoins: 99, action: 'big' },
    { on: 'gift', gift: 'Rose', action: 'rose' },
    { on: 'chat', keywords: ['A'], action: 'voteA' },
    { on: 'chat', match: '^!entrar$', action: 'join', phases: ['lobby'] },
  ];

  it('presente com regra própria vence a faixa de preço', () => {
    expect(matchRule(rules, gift('Rose', 1), 'playing')?.action).toBe('rose');
  });

  it('usa o degrau mais alto que o presente alcança', () => {
    expect(matchRule(rules, gift('Hat', 99), 'playing')?.action).toBe('big');
    expect(matchRule(rules, gift('Heart', 5), 'playing')?.action).toBe('small');
  });

  it('aceita uma lista de nomes ou ids para o mesmo presente, sem diferenciar maiúsculas', () => {
    const list: InteractionRule[] = [{ on: 'gift', gift: ['Ice Cream Cone', 'Sorvete', '5827'], action: 'ice' }];
    expect(matchRule(list, gift('sorvete', 1), 'playing')?.action).toBe('ice');
    expect(matchRule(list, { ...(gift('x', 1) as any), giftId: '5827' }, 'playing')?.action).toBe('ice');
    expect(matchRule(list, gift('Rose', 1), 'playing')).toBeNull();
  });

  it('respeita palavra-chave e fase', () => {
    const chat = (text: string): AudienceEvent => ({ kind: 'chat', id: text, platform: 'sim', viewer, at: 0, text });
    expect(matchRule(rules, chat(' a '), 'playing')?.action).toBe('voteA');
    expect(matchRule(rules, chat('!entrar'), 'playing')).toBeNull();
    expect(matchRule(rules, chat('!ENTRAR'), 'lobby')?.action).toBe('join');
  });
});

describe('GameRuntime', () => {
  const manifest: GameManifest = {
    id: 't', name: 't', aspect: '9:16',
    round: { lobbySec: 2, countdownSec: 1, durationSec: 10, resultSec: 1 },
    interactions: [{ on: 'chat', action: 'hit', cooldownMs: 1000 }],
  };
  const game: GameDefinition<{ hits: number; windows: string[] }> = {
    manifest,
    init: () => ({ hits: 0, windows: [] }),
    onPhase: (s, phase, ctx) => {
      if (phase === 'playing') ctx.openWindow('w1', 3000);
    },
    onAction: (s, _a, ctx) => {
      s.hits++;
      if (s.hits >= 3) ctx.endRound({ winner: 'chat' });
    },
    onWindowEnd: (s, id) => s.windows.push(id),
    onTimeUp: () => ({ winner: 'tempo' }),
  };

  function setup() {
    let t = 0;
    const rt = new GameRuntime(game, { now: () => t, seed: 1 });
    const at = (ms: number) => { t = ms; rt.tick(); };
    return { rt, at, chat: (id: string, ms: number) => rt.ingest([{ kind: 'chat', id, platform: 'sim', viewer: { id, handle: id, nickname: id }, at: ms, text: 'x' }]) };
  }

  it('percorre lobby, contagem, partida, resultado e recomeça', () => {
    const { rt, at } = setup();
    rt.start();
    expect(rt.phase).toBe('lobby');
    at(2000);
    expect(rt.phase).toBe('countdown');
    at(3000);
    expect(rt.phase).toBe('playing');
    expect(rt.round).toBe(1);
    at(4000);
    at(6500);
    expect((rt.snapshot().view as any).windows).toEqual(['w1']);
    at(13000);
    expect(rt.phase).toBe('result');
    expect(rt.flush().find((e) => e.type === 'round.end')?.payload).toMatchObject({ winner: 'tempo' });
    at(14000);
    expect(rt.phase).toBe('lobby');
    expect((rt.snapshot().view as any).windows).toEqual([]);
  });

  it('ignora ações fora da partida e encerra cedo quando o jogo pede', () => {
    const { rt, at, chat } = setup();
    rt.start();
    chat('a', 0);
    expect((rt.snapshot().view as any).hits).toBe(0);
    at(2000);
    at(3000);
    chat('a', 3000);
    chat('b', 3000);
    chat('c', 3000);
    expect(rt.phase).toBe('result');
    expect(rt.flush().find((e) => e.type === 'round.end')?.payload).toMatchObject({ winner: 'chat' });
  });

  it('aplica o cooldown da regra por espectador', () => {
    const { rt, at, chat } = setup();
    rt.start();
    at(2000);
    at(3000);
    chat('a', 3000);
    chat('a', 3500);
    expect((rt.snapshot().view as any).hits).toBe(1);
    chat('a', 4100);
    expect((rt.snapshot().view as any).hits).toBe(2);
  });

  it('passa o estado da rodada anterior para init e fecha janela sem chamar onWindowEnd', () => {
    let t = 0;
    const ended: string[] = [];
    const g: GameDefinition<{ round: number }> = {
      manifest: { ...manifest, round: { lobbySec: 0, countdownSec: 1, durationSec: 5, resultSec: 1 } },
      init: (_ctx, prev) => ({ round: (prev?.round ?? 0) + 1 }),
      onPhase: (_s, phase, ctx) => {
        if (phase !== 'playing') return;
        ctx.openWindow('a', 1000);
        ctx.closeWindow('a');
      },
      onAction: () => {},
      onWindowEnd: (_s, id) => ended.push(id),
    };
    const rt = new GameRuntime(g, { now: () => t });
    rt.start();
    for (t = 0; t <= 8000; t += 100) rt.tick();
    expect((rt.snapshot().view as { round: number }).round).toBe(2);
    expect(ended).toEqual([]);
    expect(rt.flush().some((e) => e.type === 'window.close' && (e.payload as any).cancelled)).toBe(true);
  });
});
