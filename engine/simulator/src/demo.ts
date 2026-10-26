// demo.json: linha do tempo de eventos falsos (e, se quiser, público
// aleatório por cima). Substitui o público falso que antes ficava no código.
import type { AudienceEvent, AudienceKind, AudienceSource, DemoEvent, DemoScript, Viewer } from '@live/core';
import { AudienceSimulator } from './index.ts';

const KINDS: AudienceKind[] = ['chat', 'gift', 'like', 'follow', 'share', 'join'];
const PLATFORMS = ['tiktok', 'twitch', 'youtube', 'kick'];

export class DemoError extends Error {}

const isNum = (v: unknown, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;

/** Confere o demo.json. Erros em português, prontos para mostrar ao publisher. */
export function parseDemo(raw: unknown): DemoScript {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new DemoError('demo.json deve ser um objeto');
  const d = raw as Record<string, unknown>;
  const viewers = d.viewers ?? [];
  if (!Array.isArray(viewers)) throw new DemoError('viewers deve ser uma lista');
  viewers.forEach((v, i) => {
    if (!v || typeof v !== 'object' || typeof (v as any).handle !== 'string' || !(v as any).handle.trim()) throw new DemoError(`viewers[${i}].handle é obrigatório`);
  });
  if (!Array.isArray(d.events) || d.events.length === 0) throw new DemoError('events deve ter pelo menos um evento');
  if (d.events.length > 2000) throw new DemoError('events: no máximo 2000 eventos');
  const events = d.events.map((e, i) => checkEvent(e, i));
  if (d.loopSec !== undefined && !isNum(d.loopSec, 1)) throw new DemoError('loopSec deve ser um número de segundos >= 1');
  const random = d.random;
  if (random !== undefined) {
    if (!random || typeof random !== 'object' || Array.isArray(random)) throw new DemoError('random deve ser um objeto');
    const r = random as Record<string, unknown>;
    for (const k of ['chatPerSec', 'likesPerSec', 'giftsPerSec']) {
      if (r[k] !== undefined && !(isNum(r[k]) && (r[k] as number) <= 50)) throw new DemoError(`random.${k} deve ser um número entre 0 e 50`);
    }
    if (r.messages !== undefined && !(Array.isArray(r.messages) && r.messages.every((m) => typeof m === 'string'))) throw new DemoError('random.messages deve ser uma lista de textos');
    if (r.gifts !== undefined) {
      if (!Array.isArray(r.gifts)) throw new DemoError('random.gifts deve ser uma lista');
      r.gifts.forEach((g: any, i: number) => {
        if (!g || typeof g.name !== 'string' || !isNum(g.coins) || !isNum(g.weight)) throw new DemoError(`random.gifts[${i}] precisa de name, coins e weight`);
      });
    }
  }
  return { ...(d as object), viewers: viewers as DemoScript['viewers'], events, ...(d.loopSec !== undefined ? { loopSec: d.loopSec as number } : {}), ...(random ? { random: random as DemoScript['random'] } : {}) };
}

function checkEvent(raw: unknown, i: number): DemoEvent {
  const where = `events[${i}]`;
  if (!raw || typeof raw !== 'object') throw new DemoError(`${where} deve ser um objeto`);
  const e = raw as DemoEvent;
  if (!isNum(e.at)) throw new DemoError(`${where}.at deve ser os segundos desde o começo (>= 0)`);
  if (!KINDS.includes(e.kind)) throw new DemoError(`${where}.kind deve ser um de: ${KINDS.join(', ')}`);
  if (e.kind === 'chat' && (typeof e.text !== 'string' || !e.text.trim())) throw new DemoError(`${where}.text é obrigatório no chat`);
  if (e.kind === 'gift') {
    if (typeof e.gift !== 'string' || !e.gift.trim()) throw new DemoError(`${where}.gift é obrigatório no presente`);
    if (!isNum(e.coins)) throw new DemoError(`${where}.coins (valor de 1 unidade) é obrigatório no presente`);
  }
  if (e.count !== undefined && !isNum(e.count, 1)) throw new DemoError(`${where}.count deve ser >= 1`);
  if (e.platform !== undefined && !PLATFORMS.includes(e.platform)) throw new DemoError(`${where}.platform deve ser um de: ${PLATFORMS.join(', ')}`);
  if (e.user !== undefined && typeof e.user !== 'string') throw new DemoError(`${where}.user deve ser texto`);
  return e;
}

/** Presentes que o demo manda (da linha do tempo e do sorteio), para os botões de teste. */
export function demoGifts(demo: DemoScript): { name: string; coins: number }[] {
  const out: { name: string; coins: number }[] = [];
  const add = (name: string, coins: number) => {
    if (!out.some((g) => g.name.toLowerCase() === name.toLowerCase())) out.push({ name, coins });
  };
  for (const e of demo.events) if (e.kind === 'gift' && e.gift) add(e.gift, e.coins ?? 1);
  for (const g of demo.random?.gifts ?? []) add(g.name, g.coins);
  return out;
}

/** Troca nomes de presentes do demo (o streamer renomeou o presente da regra no painel). */
export function renameDemoGifts(demo: DemoScript, rename: (name: string) => string): DemoScript {
  return {
    ...demo,
    events: demo.events.map((e) => (e.kind === 'gift' && e.gift ? { ...e, gift: rename(e.gift) } : e)),
    ...(demo.random?.gifts ? { random: { ...demo.random, gifts: demo.random.gifts.map((g) => ({ ...g, name: rename(g.name) })) } } : {}),
  };
}

let seq = 0;

/** Um evento do demo como evento da audiência. */
export function demoEvent(e: DemoEvent, viewer: Viewer, at = Date.now()): AudienceEvent {
  const base = { id: `demo-${++seq}-${at}`, platform: e.platform ?? ('sim' as const), viewer, at };
  switch (e.kind) {
    case 'chat':
      return { ...base, kind: 'chat', text: e.text ?? '' };
    case 'gift':
      return { ...base, kind: 'gift', giftId: e.gift!, giftName: e.gift!, coins: e.coins ?? 1, count: Math.max(1, e.count ?? 1), comboEnd: true };
    case 'like':
      return { ...base, kind: 'like', count: Math.max(1, e.count ?? 1) };
    default:
      return { ...base, kind: e.kind };
  }
}

/** Repete a linha do tempo do demo.json em loop, com o público aleatório por cima se houver. */
export class DemoSource implements AudienceSource {
  readonly name = 'simulator';
  readonly status = 'demo.json';
  private timers: ReturnType<typeof setTimeout>[] = [];
  private random: AudienceSimulator | null = null;
  private readonly viewers = new Map<string, Viewer>();
  private stopped = false;

  constructor(private readonly demo: DemoScript) {
    for (const v of demo.viewers) this.viewer(v.handle, v.nickname, v.avatarUrl);
    const r = demo.random;
    if (r && (r.chatPerSec || r.likesPerSec || r.giftsPerSec)) {
      this.random = new AudienceSimulator({
        viewers: Math.max(1, demo.viewers.length || 30),
        chatPerSec: r.chatPerSec ?? 0,
        likesPerSec: r.likesPerSec ?? 0,
        giftsPerSec: r.giftsPerSec ?? 0,
        messages: r.messages?.length ? r.messages : ['oi'],
        ...(r.gifts?.length ? { gifts: r.gifts } : {}),
        names: demo.viewers.length ? demo.viewers.map((v) => ({ handle: v.handle, nickname: v.nickname ?? v.handle, avatarUrl: v.avatarUrl })) : undefined,
      });
    }
  }

  private viewer(handle: string, nickname?: string, avatarUrl?: string): Viewer {
    const key = handle.replace(/^@/, '');
    let v = this.viewers.get(key);
    if (!v) this.viewers.set(key, (v = { id: `demo:${key}`, handle: key, nickname: nickname ?? key, ...(avatarUrl ? { avatarUrl } : {}) }));
    return v;
  }

  /** Duração de uma volta da linha do tempo, em ms. */
  get loopMs(): number {
    const last = Math.max(...this.demo.events.map((e) => e.at));
    return Math.max(1, this.demo.loopSec ?? last + 5) * 1000;
  }

  async start(emit: (e: AudienceEvent) => void): Promise<void> {
    this.stopped = false;
    const users = this.demo.viewers.map((v) => v.handle);
    let n = 0;
    const round = () => {
      if (this.stopped) return;
      for (const e of this.demo.events) {
        const user = e.user ?? users[n++ % Math.max(1, users.length)] ?? 'espectador';
        this.timers.push(setTimeout(() => !this.stopped && emit(demoEvent(e, this.viewer(user))), e.at * 1000));
      }
      this.timers.push(setTimeout(() => {
        this.timers = [];
        round();
      }, this.loopMs));
    };
    round();
    await this.random?.start(emit);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    await this.random?.stop();
  }
}
