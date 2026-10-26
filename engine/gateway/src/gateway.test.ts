import { describe, expect, it } from 'vitest';
import type { AudienceEvent, GiftEvent } from '@live/core';
import { Gateway } from './index.ts';

const viewer = (id: string) => ({ id, handle: id, nickname: id });
let n = 0;
const chat = (who: string, text: string, at = 0): AudienceEvent => ({ kind: 'chat', id: `c${++n}`, platform: 'sim', viewer: viewer(who), at, text });
const like = (who: string, count: number): AudienceEvent => ({ kind: 'like', id: `l${++n}`, platform: 'sim', viewer: viewer(who), at: 0, count });
const gift = (who: string, count: number, comboEnd: boolean, coins = 1, comboKey: string | undefined = `${who}:rose`): GiftEvent => ({
  kind: 'gift', id: `g${++n}`, platform: 'sim', viewer: viewer(who), at: 0, giftId: 'rose', giftName: 'Rose', coins, count, comboKey, comboEnd,
});

describe('Gateway', () => {
  it('remove duplicados pelo id', () => {
    const gw = new Gateway();
    const e = chat('ana', 'A');
    gw.push(e);
    gw.push(e);
    expect(gw.drain()).toHaveLength(1);
    expect(gw.stats.duplicates).toBe(1);
  });

  it('transforma combo acumulado em incrementos sem contar em dobro', () => {
    const gw = new Gateway();
    gw.push(gift('ana', 1, false));
    gw.push(gift('ana', 5, false));
    gw.push(gift('ana', 12, false));
    gw.push(gift('ana', 12, true)); // o TikTok repete o total ao fechar o combo
    const counts = gw.drain().map((e) => (e as GiftEvent).count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
    expect(counts).toHaveLength(3);
  });

  it('presente sem combo passa direto', () => {
    const gw = new Gateway();
    gw.push(gift('bia', 1, true, 1000, undefined));
    expect(gw.drain()).toMatchObject([{ kind: 'gift', count: 1 }]);
  });

  it('aplica cooldown de chat por espectador', () => {
    const gw = new Gateway({ chatCooldownMs: 1000 });
    gw.push(chat('ana', 'A', 0));
    gw.push(chat('ana', 'A', 500));
    gw.push(chat('ana', 'A', 1500));
    gw.push(chat('bia', 'B', 500));
    expect(gw.drain()).toHaveLength(3);
    expect(gw.stats.cooldown).toBe(1);
  });

  it('presente caro fura a fila', () => {
    const gw = new Gateway();
    gw.push(chat('ana', 'oi'));
    gw.push(like('bia', 3));
    gw.push(gift('caio', 1, true, 500, undefined));
    expect(gw.drain(1)[0]!.kind).toBe('gift');
  });

  it('com a fila cheia descarta curtida antes de comentário e nunca descarta presente vip', () => {
    const gw = new Gateway({ capacity: 3, chatCooldownMs: 0 });
    gw.push(gift('vip', 1, true, 1000, undefined));
    gw.push(chat('ana', 'A'));
    gw.push(like('bia', 1));
    gw.push(chat('caio', 'B'));
    const kinds = gw.drain().map((e) => e.kind).sort();
    expect(kinds).toEqual(['chat', 'chat', 'gift']);
    expect(gw.stats.dropped).toBe(1);
  });

  it('agrega curtidas do mesmo espectador', () => {
    const gw = new Gateway();
    gw.push(like('ana', 3));
    gw.push(like('ana', 4));
    gw.push(like('bia', 1));
    const likes = gw.drain();
    expect(likes).toHaveLength(2);
    expect(likes.find((e) => e.viewer.id === 'ana')).toMatchObject({ count: 7 });
  });
});
