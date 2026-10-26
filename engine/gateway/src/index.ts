import { giftValue, type AudienceEvent, type GiftEvent, type LikeEvent } from '@live/core';

export interface GatewayOptions {
  /** Máximo de eventos esperando na fila. Acima disso, descarta o de menor prioridade. */
  capacity?: number;
  /** Intervalo mínimo entre dois comentários do mesmo espectador. */
  chatCooldownMs?: number;
  /** Quantos ids lembrar para remover duplicados. */
  dedupeWindow?: number;
  /** Combo sem atualização por esse tempo é considerado encerrado. */
  comboIdleMs?: number;
  /** Presentes com valor total >= isso nunca são descartados. */
  vipGiftCoins?: number;
  now?: () => number;
}

export interface GatewayStats {
  received: number;
  duplicates: number;
  cooldown: number;
  dropped: number;
  queued: number;
}

interface Queued {
  e: AudienceEvent;
  priority: number;
  order: number;
}

interface Combo {
  emitted: number;
  lastAt: number;
}

/**
 * Fica entre a fonte (TikTok etc.) e o runtime. Remove duplicados, converte
 * combos de presente (contagem acumulada) em incrementos, aplica cooldown de
 * chat e mantém uma fila com prioridade: presente caro fura a fila, curtida é
 * a primeira a ser descartada quando a live explode.
 */
export class Gateway {
  private readonly opts: Required<GatewayOptions>;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly combos = new Map<string, Combo>();
  private readonly lastChat = new Map<string, number>();
  private queue: Queued[] = [];
  private order = 0;
  readonly stats: GatewayStats = { received: 0, duplicates: 0, cooldown: 0, dropped: 0, queued: 0 };

  constructor(options: GatewayOptions = {}) {
    this.opts = {
      capacity: 2000,
      chatCooldownMs: 1500,
      dedupeWindow: 5000,
      comboIdleMs: 6000,
      vipGiftCoins: 100,
      now: Date.now,
      ...options,
    };
  }

  push(e: AudienceEvent): void {
    this.stats.received++;
    if (this.isDuplicate(e.id)) {
      this.stats.duplicates++;
      return;
    }
    if (e.kind === 'gift') {
      const delta = this.resolveCombo(e);
      if (delta) this.enqueue(delta);
      return;
    }
    if (e.kind === 'chat') {
      const last = this.lastChat.get(e.viewer.id);
      if (last !== undefined && e.at - last < this.opts.chatCooldownMs) {
        this.stats.cooldown++;
        return;
      }
      this.lastChat.set(e.viewer.id, e.at);
    }
    this.enqueue(e);
  }

  /** Tira até `max` eventos, do mais prioritário para o menos, e agrega curtidas por espectador. */
  drain(max = Infinity): AudienceEvent[] {
    this.closeIdleCombos();
    this.queue.sort((a, b) => b.priority - a.priority || a.order - b.order);
    const taken = this.queue.splice(0, max === Infinity ? this.queue.length : max);
    this.stats.queued = this.queue.length;
    return mergeLikes(taken.map((q) => q.e));
  }

  get size(): number {
    return this.queue.length;
  }

  private isDuplicate(id: string): boolean {
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > this.opts.dedupeWindow) {
      this.seen.delete(this.seenOrder.shift()!);
    }
    return false;
  }

  /**
   * O TikTok manda o mesmo combo várias vezes com count acumulado e uma última
   * vez com comboEnd. Devolve só o incremento desde a última emissão, para o
   * jogo reagir na hora sem contar em dobro.
   */
  private resolveCombo(e: GiftEvent): GiftEvent | null {
    if (!e.comboKey) return e;
    const combo = this.combos.get(e.comboKey) ?? { emitted: 0, lastAt: e.at };
    const delta = e.count - combo.emitted;
    combo.lastAt = e.at;
    if (e.comboEnd) this.combos.delete(e.comboKey);
    else this.combos.set(e.comboKey, { emitted: Math.max(combo.emitted, e.count), lastAt: e.at });
    if (delta <= 0) return null;
    return { ...e, count: delta };
  }

  private closeIdleCombos(): void {
    const now = this.opts.now();
    for (const [key, combo] of this.combos) {
      if (now - combo.lastAt > this.opts.comboIdleMs) this.combos.delete(key);
    }
  }

  private enqueue(e: AudienceEvent): void {
    this.queue.push({ e, priority: this.priorityOf(e), order: this.order++ });
    if (this.queue.length > this.opts.capacity) this.dropLowest();
    this.stats.queued = this.queue.length;
  }

  private priorityOf(e: AudienceEvent): number {
    switch (e.kind) {
      case 'gift':
        return 1000 + giftValue(e);
      case 'follow':
      case 'share':
        return 50;
      case 'chat':
        return 20;
      case 'join':
        return 5;
      case 'like':
        return 1;
    }
  }

  private dropLowest(): void {
    let idx = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i]!;
      if (q.e.kind === 'gift' && giftValue(q.e) >= this.opts.vipGiftCoins) continue;
      const cur = idx === -1 ? undefined : this.queue[idx]!;
      // Descarta o de menor prioridade; empate, o mais antigo.
      if (!cur || q.priority < cur.priority) idx = i;
    }
    if (idx === -1) idx = 0;
    this.queue.splice(idx, 1);
    this.stats.dropped++;
  }
}

function mergeLikes(events: AudienceEvent[]): AudienceEvent[] {
  const out: AudienceEvent[] = [];
  const likeByViewer = new Map<string, LikeEvent>();
  for (const e of events) {
    if (e.kind !== 'like') {
      out.push(e);
      continue;
    }
    const prev = likeByViewer.get(e.viewer.id);
    if (prev) {
      prev.count += e.count;
      continue;
    }
    const copy = { ...e };
    likeByViewer.set(e.viewer.id, copy);
    out.push(copy);
  }
  return out;
}
