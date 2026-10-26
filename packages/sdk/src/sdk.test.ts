import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLive, type Action, type ChatEvent, type GiftEvent, type Live } from './index.ts';

const manifest = {
  id: 'corrida',
  round: { countdownSec: 0, durationSec: 60 },
  settings: { meta: 100 },
  interactions: [
    { on: 'chat' as const, keywords: ['1'], action: 'push', params: { lane: 1 } },
    { on: 'gift' as const, minCoins: 1, action: 'boost' },
  ],
};

const demo = { viewers: [{ handle: 'ana' }], events: [{ at: 1, kind: 'chat' as const, user: 'ana', text: '1' }], loopSec: 3 };

let live: Live | null = null;
afterEach(() => {
  live?.close();
  live = null;
  vi.useRealTimers();
});

describe('modo local', () => {
  it('liga sem servidor, aplica as regras do game.json e entrega eventos e ações', async () => {
    vi.useFakeTimers();
    live = createLive({ manifest, demo, audience: 'none' });
    expect(live.state.mode).toBe('local');
    const chats: ChatEvent[] = [];
    const gifts: GiftEvent[] = [];
    const pushes: Action[] = [];
    const boosts: Action[] = [];
    live.on('chat', (e) => chats.push(e));
    live.on('gift', (e) => gifts.push(e));
    live.onAction('push', (a) => pushes.push(a));
    live.onAction('boost', (a) => boosts.push(a));
    const ready = await live.start();
    expect(ready).toMatchObject({ mode: 'local', game: 'corrida', settings: { meta: 100 }, source: 'nenhuma' });

    await vi.advanceTimersByTimeAsync(200);
    expect(live.state.phase).toBe('playing');
    await live.test.chat('1', { user: 'ana' });
    await live.test.gift('Rose', { coins: 1, count: 5, user: 'bia' });
    await vi.advanceTimersByTimeAsync(200);

    expect(chats[0]).toMatchObject({ kind: 'chat', text: '1', viewer: { handle: 'ana' } });
    expect(pushes[0]).toMatchObject({ name: 'push', params: { lane: 1 }, amount: 1, event: { kind: 'chat', text: '1' } });
    expect(gifts[0]).toMatchObject({ giftName: 'Rose', coins: 1, count: 5, total: 5 });
    expect(boosts[0]).toMatchObject({ amount: 5, coins: 5, viewer: { handle: 'bia' } });
  });

  it('endRound encerra a partida e save fica guardado', async () => {
    vi.useFakeTimers();
    live = createLive({ manifest, demo, audience: 'none' });
    const ends: unknown[] = [];
    live.on('round.end', (r) => ends.push(r));
    await live.start();
    await vi.advanceTimersByTimeAsync(200);
    live.save({ recorde: 7 });
    live.endRound({ winner: 'ana' });
    await vi.advanceTimersByTimeAsync(200);
    expect(ends).toEqual([expect.objectContaining({ winner: 'ana', round: 1 })]);
    expect(live.state.phase).toBe('result');
    expect(live.state.saved).toEqual({ recorde: 7 });
  });
});

describe('demo.json', () => {
  it('o modo local repete a linha do tempo do demo.json', async () => {
    vi.useFakeTimers();
    live = createLive({ manifest, demo });
    const pushes: Action[] = [];
    live.onAction('push', (a) => pushes.push(a));
    expect((await live.start()).source).toBe('simulator');
    await vi.advanceTimersByTimeAsync(7_500);
    expect(pushes.map((a) => a.viewer.handle)).toEqual(['ana', 'ana', 'ana']);
  });

  it('recusa demo.json sem eventos', async () => {
    live = createLive({ manifest, demo: { events: [] } });
    await expect(live.start()).rejects.toThrow(/events/);
    live = null;
  });
});

describe('protocolo do motor', () => {
  it('hello + snapshot viram ready; ajustes novos viram settings; relógio do servidor', () => {
    live = createLive({ mode: 'room', room: 'abc' });
    const seen: string[] = [];
    live.on('ready', () => seen.push('ready'));
    live.on('settings', (s) => seen.push(`settings:${JSON.stringify(s)}`));
    live.receive({ t: 'hello', room: 'abc', game: 'g', info: { settings: { a: 1 }, round: {}, source: 'tiktok', saved: { x: 1 } } });
    live.receive({ t: 'snapshot', state: { now: Date.now() + 5_000, phase: 'playing', phaseEndsAt: Date.now() + 65_000, round: 2 }, seq: 1 });
    expect(seen).toEqual(['ready']);
    expect(live.state).toMatchObject({ game: 'g', source: 'tiktok', saved: { x: 1 }, phase: 'playing', round: 2 });
    expect(live.now() - Date.now()).toBeGreaterThanOrEqual(4_900);
    expect(live.timeLeft()).toBeGreaterThan(55_000);
    live.receive({ t: 'hello', room: 'abc', game: 'g', info: { settings: { a: 2 }, round: {}, source: 'tiktok', saved: null } });
    live.receive({ t: 'snapshot', state: {}, seq: 2 });
    expect(seen).toEqual(['ready', 'settings:{"a":2}', 'ready']);
  });

  it('pontos da sala viram o evento points; ranking só na sala', async () => {
    live = createLive({ mode: 'local', manifest, demo });
    const got: unknown[] = [];
    live.on('points', (p) => got.push(p));
    const viewer = { id: 'v', handle: 'ana', nickname: 'Ana' };
    live.receive({ t: 'events', events: [{ seq: 0, at: 0, type: 'points', payload: { updates: [{ platform: 'tiktok', viewer, added: 10, total: 25 }] } }] });
    expect(got).toEqual([{ platform: 'tiktok', viewer, added: 10, total: 25 }]);
    expect(await live.ranking()).toEqual([]);
  });

  it('eventos de teste não valem na sala do streamer', async () => {
    live = createLive({ mode: 'room', room: 'abc' });
    await expect(live.test.chat('oi')).rejects.toThrow(/live.start/);
  });

  it('um handler com erro não derruba os outros', () => {
    live = createLive({ mode: 'room', room: 'abc' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: string[] = [];
    live.on('like', () => {
      throw new Error('bug do jogo');
    });
    live.on('like', (e) => got.push(`${e.count}`));
    live.receive({ t: 'events', events: [{ seq: 1, at: 0, type: 'audience', payload: { id: 'l', kind: 'like', platform: 'tiktok', at: 0, viewer: { id: 'v', handle: 'v', nickname: 'v' }, count: 15 } }] });
    expect(got).toEqual(['15']);
    expect(err).toHaveBeenCalled();
  });
});
