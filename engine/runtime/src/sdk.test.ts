import { describe, expect, it } from 'vitest';
import type { AudienceEvent } from '@live/core';
import { GameRuntime, ManifestError, parseManifest, sdkGame } from './index.ts';

const viewer = { id: 'v1', handle: 'ana', nickname: 'Ana' };

describe('parseManifest', () => {
  it('preenche os padrões de um game.json mínimo', () => {
    const m = parseManifest({ id: 'corrida', interactions: [{ on: 'chat', keywords: ['1'], action: 'push' }] });
    expect(m).toMatchObject({ id: 'corrida', name: 'corrida', aspect: '9:16', round: { lobbySec: 0, countdownSec: 3, durationSec: 300, resultSec: 5 }, settings: {} });
  });

  it('recusa regra sem ação, tipo desconhecido e regex quebrada', () => {
    expect(() => parseManifest({ interactions: [{ on: 'chat' }] })).toThrow(ManifestError);
    expect(() => parseManifest({ interactions: [{ on: 'comment', action: 'x' }] })).toThrow(/interactions\[0\]\.on/);
    expect(() => parseManifest({ interactions: [{ on: 'chat', match: '(', action: 'x' }] })).toThrow(/regular/);
    expect(() => parseManifest([])).toThrow(/objeto/);
  });

  it('usa o id de reserva quando o game.json não tem um válido', () => {
    expect(parseManifest({ id: 'com espaço' }, 'meu-jogo').id).toBe('meu-jogo');
  });
});

describe('sdkGame', () => {
  it('repassa o evento da audiência e a ação da regra que casou', () => {
    let now = 1_000;
    const manifest = parseManifest({
      id: 'x',
      round: { countdownSec: 0 },
      interactions: [
        { on: 'chat', keywords: ['pula'], action: 'jump' },
        { on: 'gift', minCoins: 1, action: 'boost', params: { power: 2 } },
      ],
    });
    const rt = new GameRuntime(sdkGame(manifest), { now: () => now });
    rt.start();
    now += 10;
    rt.tick();
    expect(rt.phase).toBe('playing');
    rt.flush();

    const gift: AudienceEvent = { kind: 'gift', id: 'g1', platform: 'tiktok', viewer, at: now, giftId: '5655', giftName: 'Rose', coins: 1, count: 3, comboEnd: true };
    rt.ingest([{ kind: 'chat', id: 'c1', platform: 'twitch', viewer, at: now, text: 'pula' }, gift]);
    const events = rt.flush();
    expect(events.map((e) => e.type)).toEqual(['audience', 'action', 'audience', 'action']);
    expect(events[0]!.payload).toMatchObject({ id: 'c1', kind: 'chat', platform: 'twitch', text: 'pula' });
    expect(events[3]!.payload).toMatchObject({
      name: 'boost',
      params: { power: 2 },
      amount: 3,
      coins: 3,
      event: { kind: 'gift', giftId: '5655', giftName: 'Rose', count: 3, coins: 1, platform: 'tiktok' },
    });
  });

  it('o navegador pode encerrar a rodada', () => {
    let now = 0;
    const rt = new GameRuntime(sdkGame(parseManifest({ round: { countdownSec: 0 } })), { now: () => now });
    rt.start();
    now += 1;
    rt.tick();
    rt.flush();
    rt.endRound({ winner: 'ana' });
    expect(rt.phase).toBe('result');
    expect(rt.flush().find((e) => e.type === 'round.end')?.payload).toMatchObject({ winner: 'ana', round: 1 });
    rt.endRound({ winner: 'de novo' });
    expect(rt.flush()).toEqual([]);
  });
});
