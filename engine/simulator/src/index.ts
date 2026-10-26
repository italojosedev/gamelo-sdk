import type { AudienceEvent, AudienceSource, Viewer } from '@live/core';

export interface SimGift {
  name: string;
  coins: number;
  /** Peso relativo no sorteio. */
  weight: number;
}

export interface SimulatorOptions {
  viewers?: number;
  /** Comentários por segundo na live inteira. */
  chatPerSec?: number;
  likesPerSec?: number;
  giftsPerSec?: number;
  /** Comentários possíveis (ex.: comandos do jogo). */
  messages?: string[];
  gifts?: SimGift[];
  tickMs?: number;
  seed?: number;
  /** Espectadores com nome (demo.json); sem isso, espectador0, espectador1… */
  names?: { handle: string; nickname: string; avatarUrl?: string }[];
}

const DEFAULT_GIFTS: SimGift[] = [
  { name: 'Rose', coins: 1, weight: 60 },
  { name: 'Ice Cream Cone', coins: 1, weight: 20 },
  { name: 'Finger Heart', coins: 5, weight: 10 },
  { name: 'Doughnut', coins: 30, weight: 6 },
  { name: 'Hat', coins: 99, weight: 3 },
  { name: 'Galaxy', coins: 1000, weight: 1 },
];

/**
 * Audiência falsa para testar jogos sem live. Imita o TikTok, inclusive os
 * combos de presente que chegam várias vezes com contagem acumulada.
 */
export class AudienceSimulator implements AudienceSource {
  readonly name = 'simulator';
  readonly status = 'simulando';
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly opts: Required<Omit<SimulatorOptions, 'names'>>;
  private readonly viewers: Viewer[];
  private seq = 0;
  private rand: () => number;

  constructor(options: SimulatorOptions = {}) {
    this.opts = {
      viewers: 50,
      chatPerSec: 3,
      likesPerSec: 5,
      giftsPerSec: 0.3,
      messages: ['oi', 'kkkkk', '!entrar', 'A', 'B'],
      gifts: DEFAULT_GIFTS,
      tickMs: 200,
      seed: 1,
      ...options,
    };
    let s = this.opts.seed;
    this.rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    this.viewers = options.names?.length
      ? options.names.map((n) => ({ id: `demo:${n.handle}`, handle: n.handle, nickname: n.nickname, ...(n.avatarUrl ? { avatarUrl: n.avatarUrl } : {}) }))
      : Array.from({ length: this.opts.viewers }, (_, i) => ({
          id: `sim-${i}`,
          handle: `espectador${i}`,
          nickname: `Espectador ${i}`,
        }));
  }

  async start(emit: (e: AudienceEvent) => void): Promise<void> {
    const perTick = this.opts.tickMs / 1000;
    this.timer = setInterval(() => {
      for (const e of this.generate(perTick)) emit(e);
    }, this.opts.tickMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
  }

  /** Gera os eventos de um intervalo de `seconds` (também usado nos testes de carga). */
  generate(seconds: number): AudienceEvent[] {
    const out: AudienceEvent[] = [];
    const now = Date.now();
    for (let i = 0; i < this.poisson(this.opts.chatPerSec * seconds); i++) {
      out.push({ kind: 'chat', ...this.base(now), text: this.pick(this.opts.messages) });
    }
    for (let i = 0; i < this.poisson(this.opts.likesPerSec * seconds); i++) {
      out.push({ kind: 'like', ...this.base(now), count: 1 + Math.floor(this.rand() * 15) });
    }
    for (let i = 0; i < this.poisson(this.opts.giftsPerSec * seconds); i++) {
      out.push(...this.giftCombo(now));
    }
    return out;
  }

  private giftCombo(now: number): AudienceEvent[] {
    const gift = this.weighted(this.opts.gifts);
    const base = this.base(now);
    const comboKey = `${base.viewer.id}:${gift.name}:${this.seq}`;
    const total = gift.coins <= 5 && this.rand() < 0.4 ? 1 + Math.floor(this.rand() * 20) : 1;
    const events: AudienceEvent[] = [];
    // Como o TikTok: atualizações com contagem acumulada e uma final repetindo o total.
    for (let c = 1; c <= total; c += Math.max(1, Math.floor(total / 4))) {
      events.push({ kind: 'gift', ...base, id: `sim-${++this.seq}`, giftId: gift.name, giftName: gift.name, coins: gift.coins, count: c, comboKey, comboEnd: false });
    }
    events.push({ kind: 'gift', ...base, id: `sim-${++this.seq}`, giftId: gift.name, giftName: gift.name, coins: gift.coins, count: total, comboKey, comboEnd: true });
    return events;
  }

  private base(now: number) {
    return { id: `sim-${++this.seq}`, platform: 'sim' as const, viewer: this.pick(this.viewers), at: now };
  }

  private pick<T>(items: T[]): T {
    return items[Math.floor(this.rand() * items.length)]!;
  }

  private weighted(gifts: SimGift[]): SimGift {
    const total = gifts.reduce((s, g) => s + g.weight, 0);
    let r = this.rand() * total;
    for (const g of gifts) {
      r -= g.weight;
      if (r <= 0) return g;
    }
    return gifts[gifts.length - 1]!;
  }

  private poisson(lambda: number): number {
    if (lambda > 50) {
      // Aproximação normal para taxas altas (teste de carga).
      const z = Math.sqrt(-2 * Math.log(this.rand() || 1e-9)) * Math.cos(2 * Math.PI * this.rand());
      return Math.max(0, Math.round(lambda + z * Math.sqrt(lambda)));
    }
    const l = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.rand();
    } while (p > l);
    return k - 1;
  }
}

export * from './demo.ts';
