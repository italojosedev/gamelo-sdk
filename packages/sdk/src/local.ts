// Modo local: o mesmo laço da sala do servidor (simulador → gateway →
// runtime), rodando dentro da página. Serve para a prévia do build, testes e
// para desenvolver sem internet.
import type { AudienceEvent } from '@live/core';
import { Gateway } from '@live/gateway';
import { GameRuntime, parseManifest, sdkGame } from '@live/runtime';
import { DemoSource, parseDemo } from '@live/simulator';
import type { ServerMessage, TestEvent, Transport } from './client.ts';
import type { DemoScript, GameManifest } from './types.ts';

let seq = 0;

/** Evento falso como se viesse da live (mesmo formato do motor). */
export function fakeAudience(e: TestEvent): AudienceEvent {
  const handle = String(e.user ?? 'voce').replace(/^@/, '').slice(0, 24) || 'voce';
  const base = { id: `test-${++seq}-${Date.now()}`, platform: e.platform ?? 'sim', viewer: { id: `test:${handle}`, handle, nickname: handle }, at: Date.now() } as const;
  switch (e.kind) {
    case 'gift': {
      const name = e.gift ?? 'Rose';
      return { ...base, kind: 'gift', giftId: name, giftName: name, coins: e.coins ?? 1, count: Math.max(1, e.count ?? 1), comboEnd: true };
    }
    case 'like':
      return { ...base, kind: 'like', count: Math.max(1, e.count ?? 1) };
    case 'chat':
      return { ...base, kind: 'chat', text: e.text ?? '' };
    default:
      return { ...base, kind: e.kind };
  }
}

export function startLocal(raw: GameManifest, rawDemo: DemoScript, audience: 'sim' | 'none'): Transport {
  const manifest = parseManifest(raw, raw.id || 'local');
  // O público de mentira é o demo.json, igual ao preview no painel.
  const demo = parseDemo(rawDemo);
  const runtime = new GameRuntime(sdkGame(manifest));
  const gateway = new Gateway();
  const source = audience === 'sim' ? new DemoSource(demo) : null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let saved: unknown = null;
  return {
    async start(receive) {
      runtime.start();
      receive({ t: 'hello', room: 'local', game: manifest.id, info: { settings: manifest.settings ?? {}, round: manifest.round, source: source ? 'simulator' : 'nenhuma', saved } });
      const snap = runtime.snapshot();
      receive({ t: 'snapshot', state: snap, seq: snap.seq } as ServerMessage);
      let snapshotAt = 0;
      timer = setInterval(() => {
        runtime.ingest(gateway.drain(200));
        runtime.tick();
        const events = runtime.flush();
        if (events.length) receive({ t: 'events', events });
        const now = Date.now();
        if (events.length || now - snapshotAt > 1000) {
          snapshotAt = now;
          const s = runtime.snapshot();
          receive({ t: 'snapshot', state: s, seq: s.seq } as ServerMessage);
        }
      }, 100);
      await source?.start((e) => gateway.push(e));
    },
    send(msg) {
      if (msg.t === 'end') runtime.endRound(msg.result ?? {});
      if (msg.t === 'save') saved = msg.data;
      // msg.t === 'points': no modo local os pontos ficam no Live (memória da página).
    },
    async test(e) {
      gateway.push(fakeAudience(e));
    },
    close() {
      clearInterval(timer);
      void source?.stop();
    },
  };
}
