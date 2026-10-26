import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudienceEvent } from '@live/core';
import { DemoError, DemoSource, demoGifts, parseDemo, renameDemoGifts } from './index.ts';

const demo = {
  viewers: [{ handle: 'ana' }, { handle: 'bia', nickname: 'Bia' }],
  events: [
    { at: 0, kind: 'chat', user: 'ana', text: 'fogo' },
    { at: 2, kind: 'gift', user: 'bia', gift: 'Rose', coins: 1, count: 5 },
    { at: 3, kind: 'like', count: 10 },
  ],
  loopSec: 5,
};

afterEach(() => vi.useRealTimers());

describe('parseDemo', () => {
  it('aceita o formato e recusa o que falta', () => {
    expect(parseDemo(demo).events).toHaveLength(3);
    expect(() => parseDemo({ events: [] })).toThrow(DemoError);
    expect(() => parseDemo({ events: [{ at: 0, kind: 'chat' }] })).toThrow(/events\[0\]\.text/);
    expect(() => parseDemo({ events: [{ at: 0, kind: 'gift', gift: 'Rose' }] })).toThrow(/coins/);
    expect(() => parseDemo({ events: [{ at: -1, kind: 'join' }] })).toThrow(/at/);
    expect(() => parseDemo({ events: [{ at: 0, kind: 'comment' }] })).toThrow(/kind/);
    expect(() => parseDemo({ events: [{ at: 0, kind: 'join' }], random: { chatPerSec: 999 } })).toThrow(/chatPerSec/);
  });

  it('lista e renomeia os presentes', () => {
    const d = parseDemo({ ...demo, random: { gifts: [{ name: 'Galaxy', coins: 1000, weight: 1 }] } });
    expect(demoGifts(d)).toEqual([{ name: 'Rose', coins: 1 }, { name: 'Galaxy', coins: 1000 }]);
    expect(demoGifts(renameDemoGifts(d, (n) => (n === 'Rose' ? 'Rosa' : n)))[0]!.name).toBe('Rosa');
  });
});

describe('DemoSource', () => {
  it('repete a linha do tempo em loop com os espectadores do demo', async () => {
    vi.useFakeTimers();
    const got: AudienceEvent[] = [];
    const source = new DemoSource(parseDemo(demo));
    await source.start((e) => got.push(e));
    await vi.advanceTimersByTimeAsync(4000);
    expect(got.map((e) => e.kind)).toEqual(['chat', 'gift', 'like']);
    expect(got[1]).toMatchObject({ giftName: 'Rose', coins: 1, count: 5, viewer: { handle: 'bia', nickname: 'Bia' } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(got.map((e) => e.kind)).toEqual(['chat', 'gift', 'like', 'chat', 'gift', 'like']);
    await source.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toHaveLength(6);
  });
});
