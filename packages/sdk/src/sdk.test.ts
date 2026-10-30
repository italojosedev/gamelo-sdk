import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, createLive, createRemote, type Action, type ControlEvent, type Live, type RemoteInput } from './index.ts';

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

/** WebSocket de mentira: guarda o que o jogo mandou e deixa o teste responder como a sala. */
class FakeSocket {
  static last: FakeSocket | null = null;
  static OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  serve(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/** fetch de mentira: responde pela rota e guarda as chamadas. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { method: string; url: string; auth: string | null; body: unknown }[] = [];
  const fn = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, auth: headers.get('authorization'), body });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.startsWith(k));
    if (!key) return new Response(JSON.stringify({ message: 'Token do jogo inválido.' }), { status: 401 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  });
  return { calls, restore: () => fn.mockRestore() };
}

describe('sala de teste', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sem ?room= e sem token de teste explica o que falta', async () => {
    live = createLive({ manifest, demo });
    expect(live.state.mode).toBe('test');
    await expect(live.start()).rejects.toThrow(/token de teste/);
    live = null;
  });

  it('abre a sala de teste na API com o game.json e o demo.json, e testa, pontua e lê o ranking por ela', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const api = 'https://api.gamelo.test';
    const net = fakeFetch({
      [`POST ${api}/sdk/dev-rooms/dev-sala/test`]: { ok: true },
      [`POST ${api}/sdk/dev-rooms`]: { room: 'dev-sala', engine: api, game: { slug: 'corrida', name: 'Corrida' } },
      [`GET ${api}/sdk/rooms/dev-sala/points?limit=5`]: { ranking: [{ rank: 1, platform: 'sim', viewer: { id: 'test:ana' }, points: 60 }] },
    });
    live = createLive({ manifest, demo, token: 'lgt_abc', engine: api, devtools: false });
    const started = live.start();
    await vi.waitFor(() => expect(FakeSocket.last?.url).toBe('wss://api.gamelo.test/ws?room=dev-sala'));
    const ws = FakeSocket.last!;
    ws.serve({ t: 'hello', room: 'dev-sala', game: 'corrida', info: { settings: { meta: 100 }, round: {}, source: 'simulator', saved: null } });
    ws.serve({ t: 'snapshot', state: { now: Date.now(), phase: 'playing', phaseEndsAt: Date.now() + 60_000, round: 1 }, seq: 1 });
    expect(await started).toMatchObject({ mode: 'test', room: 'dev-sala', game: 'corrida', source: 'simulator', settings: { meta: 100 } });
    expect(net.calls[0]).toMatchObject({ method: 'POST', url: `${api}/sdk/dev-rooms`, auth: 'Bearer lgt_abc', body: { manifest, demo, audience: 'sim' } });

    const pushes: Action[] = [];
    live.onAction('push', (a) => pushes.push(a));
    await live.test.chat('1', { user: 'ana' });
    expect(net.calls[1]).toMatchObject({ url: `${api}/sdk/dev-rooms/dev-sala/test`, auth: 'Bearer lgt_abc', body: { kind: 'chat', text: '1', user: 'ana' } });
    const ana = { id: 'test:ana', handle: 'ana', nickname: 'ana' };
    const chat = { id: 'e1', kind: 'chat', platform: 'sim', viewer: ana, at: 0, text: '1' };
    ws.serve({ t: 'events', events: [{ seq: 2, at: 0, type: 'action', payload: { name: 'push', params: { lane: 1 }, event: chat } }] });
    expect(pushes[0]).toMatchObject({ name: 'push', params: { lane: 1 }, viewer: { handle: 'ana' } });

    live.addPoints(pushes[0]!, 60);
    expect(ws.sent).toEqual([{ t: 'points', add: [{ platform: 'sim', viewerId: 'test:ana', points: 60, id: 'e1' }] }]);
    expect((await live.ranking(5))[0]).toMatchObject({ points: 60 });
    live.endRound({ winner: 'ana' });
    live.save({ recorde: 7 });
    expect(ws.sent.slice(1)).toEqual([{ t: 'end', result: { winner: 'ana' } }, { t: 'save', data: { recorde: 7 } }]);
    net.restore();
  });

  it('sem `engine`, usa a API da Gamelo', () => {
    live = createLive({ token: 'lgt_abc' });
    expect(live.api.engine).toBe('https://api.gamelo.com.br');
  });
});

describe('createApi', () => {
  it('envia e lista versões com o token de publicação e mostra o erro da API em português', async () => {
    const api = createApi({ token: 'lgp_pub', engine: 'https://api.gamelo.test/' });
    expect(api.tokenKind).toBe('publish');
    expect(createApi({ token: 'lgt_x' }).tokenKind).toBe('test');
    expect(createApi({ token: 'lg_antigo' }).tokenKind).toBe('publish');
    const net = fakeFetch({
      'POST https://api.gamelo.test/sdk/builds': { id: 3, version: '3', notes: 'arena' },
      'GET https://api.gamelo.test/sdk/builds': [{ id: 3, version: '3', status: 'uploaded', current: false }],
    });
    expect(await api.uploadBuild(new Uint8Array([1, 2]), 'arena')).toMatchObject({ version: '3' });
    const form = net.calls[0]!.body as FormData;
    expect(net.calls[0]!.auth).toBe('Bearer lgp_pub');
    expect(form.get('notes')).toBe('arena');
    expect((form.get('bundle') as File).name).toBe('game.zip');
    expect(await api.builds()).toMatchObject([{ version: '3', status: 'uploaded' }]);
    await expect(api.game()).rejects.toMatchObject({ name: 'ApiError', status: 401, message: 'Token do jogo inválido.' });
    await expect(createApi().builds()).rejects.toThrow(/Falta o token/);
    net.restore();
  });

  it('ranking e pontos de um espectador vão sem token, pela chave da sala', async () => {
    const net = fakeFetch({ 'GET https://api.gamelo.com.br/sdk/rooms/sala%2F1/points/viewer?platform=tiktok&id=a%3A1': { points: 9, rank: 2 } });
    expect(await createApi().viewerPoints('sala/1', 'tiktok', 'a:1')).toEqual({ points: 9, rank: 2 });
    expect(net.calls[0]!.auth).toBeNull();
    net.restore();
  });
});

describe('protocolo da sala', () => {
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

  it('pontos da sala viram o evento points', () => {
    live = createLive({ mode: 'room', room: 'abc' });
    const got: unknown[] = [];
    live.on('points', (p) => got.push(p));
    const viewer = { id: 'v', handle: 'ana', nickname: 'Ana' };
    live.receive({ t: 'events', events: [{ seq: 0, at: 0, type: 'points', payload: { updates: [{ platform: 'tiktok', viewer, added: 10, total: 25 }] } }] });
    expect(got).toEqual([{ platform: 'tiktok', viewer, added: 10, total: 25 }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    live.addPoints({ platform: 'tiktok', viewer }, 0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('na sala, addPoints vai pelo WebSocket e viewerPoints lê da API', async () => {
    live = createLive({ mode: 'room', room: 'sala-123', engine: 'https://api.gamelo.test' });
    const sent: unknown[] = [];
    (live as any).transport = { send: (m: unknown) => sent.push(m), close() {} };
    const viewer = { id: 'tw:9', handle: 'ana', nickname: 'Ana' };
    live.addPoints({ id: 'ev-1', platform: 'twitch', viewer }, 40);
    expect(sent).toEqual([{ t: 'points', add: [{ platform: 'twitch', viewerId: 'tw:9', points: 40, id: 'ev-1' }] }]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ platform: 'twitch', viewer, points: 340, rank: 3 })));
    expect(await live.viewerPoints({ platform: 'twitch', viewer })).toMatchObject({ points: 340, rank: 3 });
    expect(String(fetch.mock.calls[0]![0])).toBe('https://api.gamelo.test/sdk/rooms/sala-123/points/viewer?platform=twitch&id=tw%3A9');
    fetch.mockRestore();
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

describe('botões do streamer (controls)', () => {
  it('chegam em live.on("control") e em live.onControl(id), com o texto do campo', () => {
    live = createLive({ manifest, demo, mode: 'room', room: 'sala' });
    const all: ControlEvent[] = [];
    const alerts: (string | null)[] = [];
    live.on('control', (c) => all.push(c));
    live.onControl('alerta', (c) => alerts.push(c.value));
    live.receive({
      t: 'events',
      events: [
        { seq: 0, at: 1, type: 'control', payload: { id: 'votacao', value: null } },
        { seq: 0, at: 2, type: 'control', payload: { id: 'alerta', value: 'Observem os olhares!' } },
        { seq: 0, at: 3, type: 'control', payload: { value: 'sem id' } },
      ],
    });
    expect(all).toEqual([
      { id: 'votacao', value: null },
      { id: 'alerta', value: 'Observem os olhares!' },
    ]);
    expect(alerts).toEqual(['Observem os olhares!']);
  });

  it('live.test.control só vale na sala de teste', async () => {
    live = createLive({ manifest, demo, mode: 'room', room: 'sala' });
    (live as any).transport = { send() {}, close() {}, control: async () => {} };
    await expect(live.test.control('votacao')).rejects.toThrow(/sala do streamer/);
  });
});

describe('controle remoto', () => {
  it('o jogo recebe os comandos da página de controle em live.on("remote") e desenha o QR', () => {
    live = createLive({ manifest, demo, mode: 'room', room: 'sala' });
    const inputs: RemoteInput[] = [];
    live.on('remote', (i) => inputs.push(i));
    const remote = { url: 'https://site/jogar/abc', qr: 'https://api/remote/abc/qr.svg', corner: 'bl' as const, size: 22, label: 'Jogue', draw: true };
    live.receive({ t: 'hello', room: 'sala', game: 'corrida', info: { settings: {}, round: {}, source: 'tiktok', saved: null, remote } });
    expect(live.remote).toEqual(remote);
    live.receive({ t: 'events', events: [{ seq: 0, at: 1, type: 'remote', payload: { name: 'pular', data: { x: 1 }, platform: 'web', viewer: { id: 'web:a', handle: 'ana', nickname: 'ana' } } }] });
    expect(inputs).toEqual([{ name: 'pular', data: { x: 1 }, platform: 'web', viewer: { id: 'web:a', handle: 'ana', nickname: 'ana' } }]);
  });

  it('shareRemote manda o estado para os celulares só quando muda, e de novo ao reconectar', () => {
    live = createLive({ manifest, demo, mode: 'room', room: 'sala' });
    const sent: unknown[] = [];
    (live as any).transport = { send: (m: unknown) => sent.push(m), close() {} };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    live.shareRemote({ k: 'gyx' });
    live.shareRemote({ k: 'gyx' });
    live.shareRemote('x'.repeat(3000));
    expect(warn).toHaveBeenCalled();
    live.receive({ t: 'hello', room: 'sala', game: 'corrida', info: { settings: {}, round: {}, source: 'tiktok', saved: null } });
    expect(sent).toEqual([
      { t: 'remote', data: { k: 'gyx' } },
      { t: 'remote', data: { k: 'gyx' } },
    ]);
    warn.mockRestore();
  });

  it('createRemote: sala de teste com o token de teste, e exige apelido antes de mandar', async () => {
    const r = createRemote();
    expect(r.state.mode).toBe('test');
    await expect(r.start()).rejects.toThrow(/token de teste/);
    await expect(r.send('pular')).rejects.toThrow(/join/);
    const net = fakeFetch({
      'GET https://api.gamelo.com.br/sdk/dev-room/remote': { game: 'Corrida', streamer: 'teste', on: true, phase: 'playing', shared: { k: 'g' } },
      'POST https://api.gamelo.com.br/sdk/dev-room/remote': { ok: true },
    });
    const t = createRemote({ token: 'lgt_abc' });
    expect(await t.start()).toMatchObject({ mode: 'test', game: 'Corrida', phase: 'playing', on: true, shared: { k: 'g' } });
    await t.join('ana');
    await t.send('pular', { x: 1 });
    expect(net.calls.at(-1)).toMatchObject({ method: 'POST', auth: 'Bearer lgt_abc', body: { nick: 'ana', kind: 'input', name: 'pular', data: { x: 1 } } });
    t.stop();
    net.restore();
  });
});
