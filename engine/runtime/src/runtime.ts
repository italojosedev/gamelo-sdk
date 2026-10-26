import type { AudienceEvent, DemoScript, GameEvent, Viewer } from '@live/core';
import { amountOf, coinsOf, matchRule, type GameManifest, type Phase } from './manifest.ts';
import { createRng, type Rng } from './rng.ts';

/** O que a regra do manifesto entrega para a lógica do jogo. */
export interface Action {
  name: string;
  viewer: Viewer;
  /** Unidades: quantidade do presente, nº de curtidas, 1 para chat. */
  amount: number;
  /** Valor total em moedas (0 se não for presente). */
  coins: number;
  params: Record<string, unknown>;
  source: AudienceEvent;
}

export interface RoundResult {
  winner?: string;
  summary?: unknown;
}

export interface GameContext {
  readonly manifest: GameManifest;
  readonly settings: Record<string, unknown>;
  readonly rng: Rng;
  readonly phase: Phase;
  readonly round: number;
  now(): number;
  emit(type: string, payload?: unknown): void;
  /** Abre uma janela de contagem. No fim, chama onWindowEnd(id). */
  openWindow(id: string, durationMs: number, payload?: unknown): void;
  /** Fecha uma janela antes do fim, sem chamar onWindowEnd. */
  closeWindow(id: string): void;
  /** Encerra a partida antes do tempo. */
  endRound(result?: RoundResult): void;
}

/** O que um desenvolvedor escreve para criar um jogo. */
export interface GameDefinition<S> {
  manifest: GameManifest;
  /** demo.json: público de mentira do preview, do "Testar" e da sala de desenvolvimento. */
  demo?: DemoScript;
  /**
   * Estado novo para cada rodada. `previous` é o estado da rodada que acabou
   * (undefined na primeira), para o jogo levar adiante o que quiser, como um recorde.
   */
  init(ctx: GameContext, previous?: S): S;
  onPhase?(state: S, phase: Phase, ctx: GameContext): void;
  onAction(state: S, action: Action, ctx: GameContext): void;
  onTick?(state: S, dtMs: number, ctx: GameContext): void;
  onWindowEnd?(state: S, windowId: string, ctx: GameContext): void;
  /** Chamado quando a partida acaba por tempo. Devolve o vencedor. */
  onTimeUp?(state: S, ctx: GameContext): RoundResult;
  /** O que vai para o overlay no snapshot. Padrão: o estado inteiro. */
  view?(state: S): unknown;
}

export interface RuntimeOptions {
  seed?: number;
  now?: () => number;
  /** Quantos GameEvents guardar para quem conectar no meio (replay curto). */
  historySize?: number;
}

interface Window {
  id: string;
  endsAt: number;
  durationMs: number;
}

/**
 * Executa um jogo: máquina de rodada (lobby → contagem → partida → resultado →
 * lobby), janelas de contagem, regras do manifesto e emissão de GameEvents.
 * Não sabe nada de tela nem de rede, então roda igual no servidor e nos testes.
 */
export class GameRuntime<S> {
  private state!: S;
  private phaseValue: Phase = 'lobby';
  private phaseEndsAt = 0;
  private roundNo = 0;
  private seq = 0;
  private lastTick: number;
  private windows: Window[] = [];
  private pending: GameEvent[] = [];
  private readonly history: GameEvent[] = [];
  private readonly cooldowns = new Map<string, number>();
  private endRequested: RoundResult | null = null;
  private readonly ctx: GameContext;
  private readonly now: () => number;
  private readonly historySize: number;
  readonly rng: Rng;

  constructor(
    readonly game: GameDefinition<S>,
    options: RuntimeOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.historySize = options.historySize ?? 200;
    this.rng = createRng(options.seed ?? Date.now());
    this.lastTick = this.now();
    const self = this;
    this.ctx = {
      manifest: game.manifest,
      settings: game.manifest.settings ?? {},
      rng: this.rng,
      get phase() {
        return self.phaseValue;
      },
      get round() {
        return self.roundNo;
      },
      now: () => this.now(),
      emit: (type, payload) => this.emit(type, payload),
      openWindow: (id, durationMs, payload) => {
        const endsAt = this.now() + durationMs;
        this.windows = this.windows.filter((w) => w.id !== id);
        this.windows.push({ id, endsAt, durationMs });
        this.emit('window.open', { id, endsAt, durationMs, ...(payload as object) });
      },
      closeWindow: (id) => {
        if (!this.windows.some((w) => w.id === id)) return;
        this.windows = this.windows.filter((w) => w.id !== id);
        this.emit('window.close', { id, cancelled: true });
      },
      endRound: (result) => {
        this.endRequested = result ?? {};
      },
    };
  }

  get phase(): Phase {
    return this.phaseValue;
  }

  get round(): number {
    return this.roundNo;
  }

  start(): void {
    this.state = this.game.init(this.ctx);
    const { lobbySec } = this.game.manifest.round;
    if (lobbySec > 0) this.enter('lobby', lobbySec);
    else this.enter('countdown', this.game.manifest.round.countdownSec);
  }

  /** Aplica eventos da audiência já tratados pelo gateway. */
  ingest(events: AudienceEvent[]): void {
    for (const e of events) {
      this.emit('audience', summarize(e));
      const rule = matchRule(this.game.manifest.interactions, e, this.phaseValue);
      if (!rule) continue;
      if (rule.cooldownMs) {
        const key = `${rule.action}:${e.viewer.id}`;
        const until = this.cooldowns.get(key) ?? 0;
        if (e.at < until) continue;
        this.cooldowns.set(key, e.at + rule.cooldownMs);
      }
      this.game.onAction(
        this.state,
        { name: rule.action, viewer: e.viewer, amount: amountOf(e), coins: coinsOf(e), params: rule.params ?? {}, source: e },
        this.ctx,
      );
    }
    this.checkEnd();
  }

  tick(): void {
    const now = this.now();
    const dt = now - this.lastTick;
    this.lastTick = now;

    if (this.phaseValue === 'playing') {
      this.game.onTick?.(this.state, dt, this.ctx);
      const due = this.windows.filter((w) => w.endsAt <= now);
      this.windows = this.windows.filter((w) => w.endsAt > now);
      for (const w of due) {
        this.emit('window.close', { id: w.id });
        this.game.onWindowEnd?.(this.state, w.id, this.ctx);
      }
      if (this.checkEnd()) return;
    }

    if (now < this.phaseEndsAt) return;
    switch (this.phaseValue) {
      case 'lobby':
        this.enter('countdown', this.game.manifest.round.countdownSec);
        break;
      case 'countdown':
        this.enter('playing', this.game.manifest.round.durationSec);
        break;
      case 'playing':
        this.finish(this.game.onTimeUp?.(this.state, this.ctx) ?? {});
        break;
      case 'result':
        this.state = this.game.init(this.ctx, this.state);
        this.enter(this.game.manifest.round.lobbySec > 0 ? 'lobby' : 'countdown', this.game.manifest.round.lobbySec || this.game.manifest.round.countdownSec);
        break;
    }
  }

  /** Encerra a partida de fora da lógica (ex.: o jogo do SDK, que roda no navegador, pediu). */
  endRound(result: RoundResult = {}): void {
    if (this.phaseValue !== 'playing') return;
    this.finish(result);
  }

  /** GameEvents novos desde a última chamada. */
  flush(): GameEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  snapshot(): { now: number; phase: Phase; phaseEndsAt: number; round: number; seq: number; windows: Window[]; view: unknown } {
    return {
      // Hora do servidor, para o overlay acertar o relógio e animar no mesmo tempo.
      now: this.now(),
      phase: this.phaseValue,
      phaseEndsAt: this.phaseEndsAt,
      round: this.roundNo,
      seq: this.seq,
      // Para quem conecta no meio de uma janela ainda ver o cronômetro.
      windows: [...this.windows],
      view: this.game.view ? this.game.view(this.state) : this.state,
    };
  }

  recent(): GameEvent[] {
    return [...this.history];
  }

  private checkEnd(): boolean {
    if (this.endRequested && this.phaseValue === 'playing') {
      this.finish(this.endRequested);
      return true;
    }
    this.endRequested = null;
    return false;
  }

  private finish(result: RoundResult): void {
    this.endRequested = null;
    this.windows = [];
    this.emit('round.end', { round: this.roundNo, ...result });
    this.enter('result', this.game.manifest.round.resultSec);
  }

  private enter(phase: Phase, seconds: number): void {
    if (phase === 'playing') this.roundNo++;
    this.phaseValue = phase;
    this.phaseEndsAt = this.now() + seconds * 1000;
    this.emit('phase', { phase, endsAt: this.phaseEndsAt, round: this.roundNo });
    this.game.onPhase?.(this.state, phase, this.ctx);
  }

  private emit(type: string, payload: unknown = {}): void {
    const ev: GameEvent = { seq: ++this.seq, at: this.now(), type, payload };
    this.pending.push(ev);
    this.history.push(ev);
    if (this.history.length > this.historySize) this.history.shift();
  }
}

/** O evento da audiência como vai no GameEvent "audience" (contrato do SDK no EVENTS.md do repositório gamelo-sdk). */
export function summarize(e: AudienceEvent) {
  const base = { id: e.id, kind: e.kind, platform: e.platform, at: e.at, viewer: e.viewer };
  switch (e.kind) {
    case 'chat':
      return { ...base, text: e.text };
    case 'gift':
      return { ...base, giftId: e.giftId, giftName: e.giftName, count: e.count, coins: e.coins };
    case 'like':
      return { ...base, count: e.count };
    default:
      return base;
  }
}
