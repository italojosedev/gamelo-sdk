import { showRemoteQr } from '@live/core';
import { mountDevtools } from './devtools.ts';
import { startLocal } from './local.ts';
import type {
  Action,
  AudienceEvent,
  AudienceKind,
  DemoScript,
  GameEvent,
  GameManifest,
  LiveEvents,
  Mode,
  PhaseChange,
  PointsUpdate,
  RankingEntry,
  RemoteInfo,
  RemoteInput,
  RoomState,
  RoundEnd,
  Status,
} from './types.ts';

/** Mensagens do motor (mesmo protocolo do overlay embutido). */
export type ServerMessage =
  | { t: 'hello'; room: string; game: string; info?: { settings: Record<string, unknown>; round: unknown; source: string; saved: unknown; remote?: RemoteInfo } }
  | { t: 'snapshot'; state: { now?: number; phase?: string; phaseEndsAt?: number; round?: number }; seq: number }
  | { t: 'events'; events: GameEvent[] };

export type ClientMessage = { t: 'end'; result?: { winner?: string; summary?: unknown } } | { t: 'save'; data: unknown };

/** Evento falso para testar (botões de teste, `live.test.*`). */
export interface TestEvent {
  kind: AudienceKind;
  text?: string;
  gift?: string;
  coins?: number;
  count?: number;
  user?: string;
  platform?: 'tiktok' | 'twitch' | 'youtube' | 'kick' | 'web';
}

/** Canal entre a página de controle e o jogo no modo local (abas do mesmo navegador). */
export const LOCAL_REMOTE_CHANNEL = 'gamelo-remote';
export type LocalRemoteMessage =
  | { t: 'hello' }
  | { t: 'state'; game: string; phase: string }
  | { t: 'send'; device: string; nick: string; kind: 'input' | 'chat' | 'like' | 'join'; name?: string; data?: unknown; text?: string };

/** Ligação com o motor: WebSocket (sala ou desenvolvimento) ou o motor rodando na própria página. */
export interface Transport {
  start(receive: (msg: ServerMessage) => void): Promise<void>;
  send(msg: ClientMessage): void;
  test(e: TestEvent): Promise<void>;
  close(): void;
}

export interface LiveOptions {
  /**
   * "room": overlay da sala do streamer (usa ?room= e ?engine= da URL; é como o jogo roda na live).
   * "dev": sala de desenvolvimento no motor, com o token do jogo e público simulado.
   * "local": tudo na página, sem servidor (prévia, testes, sem internet).
   * "auto" (padrão): room se a URL tem ?room=, dev se veio `token`, senão local.
   */
  mode?: Mode | 'auto';
  /** Token da API do jogo (painel do publisher). Só no desenvolvimento: nunca publique o token no build. */
  token?: string;
  /** Endereço da API da Gamelo (ex.: https://api.exemplo.com). Na sala vem do ?engine= da URL. */
  engine?: string;
  /** Chave da sala. Padrão: ?room= da URL. */
  room?: string;
  /** game.json do jogo. Padrão: busca ./game.json ao lado do index.html. */
  manifest?: GameManifest;
  /** demo.json do jogo (eventos do preview). Padrão: busca ./demo.json ao lado do index.html. */
  demo?: DemoScript;
  /** dev e local: "sim" repete o demo.json (padrão); "none" deixa só os eventos de teste. */
  audience?: 'sim' | 'none';
  /** Painel de teste flutuante (padrão: ligado em dev e local, nunca na sala). */
  devtools?: boolean;
  /**
   * QR code do controle remoto (o streamer liga em "Controlar sala"): o SDK
   * mostra num canto da tela. false se o jogo desenha o QR por conta própria
   * (o link e a imagem vêm em `live.remote`).
   */
  remoteQr?: boolean;
}

type Handler<T> = (payload: T) => void;

const KINDS: AudienceKind[] = ['chat', 'gift', 'like', 'follow', 'share', 'join'];

/**
 * O SDK de um jogo. Crie com `createLive()`, registre os handlers com `on`
 * e `onAction` e chame `start()`.
 */
export class Live {
  readonly state: RoomState;
  /** Controle remoto ligado com QR na tela: link da página, imagem do QR, canto e tamanho. null quando desligado. */
  remote: RemoteInfo | null = null;
  /** Eventos falsos para testar (dev e local). */
  readonly test: {
    chat(text: string, opts?: Omit<TestEvent, 'kind' | 'text'>): Promise<void>;
    gift(name: string, opts?: Omit<TestEvent, 'kind' | 'gift'>): Promise<void>;
    like(count?: number, opts?: Omit<TestEvent, 'kind' | 'count'>): Promise<void>;
    follow(opts?: Omit<TestEvent, 'kind'>): Promise<void>;
    share(opts?: Omit<TestEvent, 'kind'>): Promise<void>;
    join(opts?: Omit<TestEvent, 'kind'>): Promise<void>;
  };
  private readonly handlers = new Map<string, Set<Handler<any>>>();
  private readonly actionHandlers = new Map<string, Set<Handler<Action>>>();
  private transport: Transport | null = null;
  private offset = 0;
  private synced = false;
  private manifestValue: GameManifest | null;
  private demoValue: DemoScript | null;
  private readonly params: URLSearchParams;

  constructor(private readonly opts: LiveOptions = {}) {
    this.params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    const room = opts.room ?? this.params.get('room') ?? '';
    const mode: Mode = opts.mode && opts.mode !== 'auto' ? opts.mode : room ? 'room' : opts.token ? 'dev' : 'local';
    this.manifestValue = opts.manifest ?? null;
    this.demoValue = opts.demo ?? null;
    this.state = { mode, status: 'offline', room, game: '', phase: 'lobby', round: 0, phaseEndsAt: 0, settings: {}, source: '', saved: null };
    const send = (e: TestEvent) => this.sendTest(e);
    this.test = {
      chat: (text, o) => send({ ...o, kind: 'chat', text }),
      gift: (gift, o) => send({ ...o, kind: 'gift', gift }),
      like: (count = 1, o) => send({ ...o, kind: 'like', count }),
      follow: (o) => send({ ...o, kind: 'follow' }),
      share: (o) => send({ ...o, kind: 'share' }),
      join: (o) => send({ ...o, kind: 'join' }),
    };
  }

  /** Ajustes valendo nesta sala. */
  get settings(): Record<string, unknown> {
    return this.state.settings;
  }

  /** O game.json carregado (null antes do `start`). */
  get manifest(): GameManifest | null {
    return this.manifestValue;
  }

  /** O demo.json carregado (null na sala do streamer e antes do `start`). */
  get demo(): DemoScript | null {
    return this.demoValue;
  }

  /** Ouve um evento. Devolve a função que para de ouvir. */
  on<K extends keyof LiveEvents>(type: K, fn: Handler<LiveEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Ouve uma ação do game.json pelo nome (o `action` da regra). */
  onAction(name: string, fn: Handler<Action>): () => void {
    let set = this.actionHandlers.get(name);
    if (!set) this.actionHandlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Conecta. Resolve quando a sala respondeu (evento `ready`). */
  async start(): Promise<RoomState> {
    if (this.transport) throw new Error('live.start() já foi chamado');
    const ready = new Promise<RoomState>((resolve) => {
      const off = this.on('ready', (s) => {
        off();
        resolve(s);
      });
    });
    this.setStatus('connecting');
    const { mode } = this.state;
    if (mode !== 'room') {
      this.manifestValue ??= await loadJson<GameManifest>('game.json', 'manifest');
      this.demoValue ??= await loadJson<DemoScript>('demo.json', 'demo');
    }
    if (mode === 'room') {
      const engine = this.opts.engine ?? this.params.get('engine') ?? location.origin;
      if (!this.state.room) throw new Error('Sem ?room= na URL: abra o jogo pelo link do overlay da sala.');
      this.transport = socketTransport(engine, () => this.state.room, (s) => this.setStatus(s));
    } else if (mode === 'dev') {
      const engine = this.opts.engine;
      if (!engine || !this.opts.token) throw new Error('O modo dev precisa de `engine` (URL da API) e `token` (painel do publisher).');
      this.transport = devTransport(engine, this.opts.token, this.manifestValue!, this.demoValue!, this.opts.audience ?? 'sim', (s) => this.setStatus(s), (room) => {
        this.state.room = room;
      });
    } else {
      this.transport = startLocal(this.manifestValue!, this.demoValue!, this.opts.audience ?? 'sim');
    }
    await this.transport.start((msg) => this.receive(msg));
    if (mode === 'local') this.listenLocalRemote();
    if (mode !== 'room' && (this.opts.devtools ?? true) && typeof document !== 'undefined') mountDevtools(this);
    return ready;
  }

  /**
   * Modo local: a página de controle aberta em outra aba (createRemote() sem
   * token) fala com o jogo por BroadcastChannel, sem servidor.
   */
  private listenLocalRemote() {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(LOCAL_REMOTE_CHANNEL);
    channel.onmessage = (m) => {
      const msg = m.data as LocalRemoteMessage;
      if (msg?.t === 'hello') channel.postMessage({ t: 'state', game: this.manifest?.name ?? '', phase: this.state.phase } satisfies LocalRemoteMessage);
      if (msg?.t !== 'send') return;
      const viewer = { id: `web:${msg.device}`, handle: msg.nick, nickname: msg.nick };
      if (msg.kind === 'input') this.play({ seq: 0, at: Date.now(), type: 'remote', payload: { name: msg.name, data: msg.data ?? null, platform: 'web', viewer } });
      else void this.transport?.test({ kind: msg.kind, text: msg.text, user: msg.nick, platform: 'web' });
    };
    this.on('phase', (p) => channel.postMessage({ t: 'state', game: this.manifest?.name ?? '', phase: p.phase } satisfies LocalRemoteMessage));
  }

  /** Hora do servidor em ms. Use no lugar de Date.now() para cronômetros e animações. */
  now(): number {
    return Date.now() + this.offset;
  }

  /** Milissegundos até o fim da fase atual. */
  timeLeft(): number {
    return Math.max(0, this.state.phaseEndsAt - this.now());
  }

  /** Encerra a partida agora (vai para "result"). Só vale durante "playing". */
  endRound(result: { winner?: string; summary?: unknown } = {}): void {
    this.transport?.send({ t: 'end', result });
  }

  /**
   * Guarda um estado pequeno (até ~60 KB em JSON) na sala, para o jogo
   * continuar se o overlay recarregar. Volta em `live.state.saved`.
   */
  save(data: unknown): void {
    this.state.saved = data;
    this.transport?.send({ t: 'save', data });
  }

  /** URL da foto de perfil pelo proxy do motor (o navegador do OBS bloqueia as originais por CORS). */
  avatar(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const base = this.state.mode === 'local' ? '' : (this.opts.engine ?? this.params.get('engine') ?? '');
    return base ? `${base.replace(/\/$/, '')}/avatar?u=${encodeURIComponent(url)}` : url;
  }

  /**
   * Ranking de pontos dos espectadores nesta sala, do maior para o menor
   * (até 100). Só a sala do streamer tem pontuação; em dev e local volta vazio.
   * Para atualizar ao vivo, ouça `live.on('points', ...)`.
   */
  async ranking(limit = 10): Promise<RankingEntry[]> {
    if (this.state.mode !== 'room' || !this.state.room) return [];
    const engine = this.opts.engine ?? this.params.get('engine') ?? location.origin;
    const url = new URL(`/sdk/rooms/${encodeURIComponent(this.state.room)}/points`, engine);
    url.searchParams.set('limit', String(Math.min(Math.max(1, Math.floor(limit)), 100)));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[gamelo] ranking: erro ${res.status}`);
    return ((await res.json()) as { ranking: RankingEntry[] }).ranking;
  }

  /** Desconecta. */
  close(): void {
    this.transport?.close();
    this.transport = null;
    this.setStatus('offline');
  }

  private async sendTest(e: TestEvent): Promise<void> {
    if (!this.transport) throw new Error('Chame live.start() antes');
    if (this.state.mode === 'room') throw new Error('Eventos de teste não valem na sala do streamer: use o "Testar" do painel.');
    await this.transport.test(e);
  }

  private setStatus(s: Status) {
    if (this.state.status === s) return;
    this.state.status = s;
    this.emit('status', s);
  }

  private emit<K extends keyof LiveEvents>(type: K, payload: LiveEvents[K]) {
    for (const fn of this.handlers.get(type) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[gamelo] erro no handler de "${type}"`, err);
      }
    }
  }

  /** Mensagem do motor → estado e eventos do jogo. Exposto para testes. */
  receive(msg: ServerMessage): void {
    if (msg.t === 'hello') {
      const changed = JSON.stringify(msg.info?.settings ?? {}) !== JSON.stringify(this.state.settings);
      this.state.game = msg.game;
      if (msg.info) {
        this.remote = msg.info.remote ?? null;
        if (this.opts.remoteQr !== false) showRemoteQr(this.remote);
        this.state.settings = msg.info.settings ?? {};
        this.state.source = msg.info.source;
        this.state.saved = msg.info.saved ?? null;
      }
      this.pendingReady = true;
      if (changed && this.readyOnce) this.emit('settings', this.state.settings);
      this.setStatus('online');
      return;
    }
    if (msg.t === 'snapshot') {
      const s = msg.state;
      if (typeof s.now === 'number') this.syncClock(s.now);
      if (s.phase) this.state.phase = s.phase as RoomState['phase'];
      if (typeof s.phaseEndsAt === 'number') this.state.phaseEndsAt = s.phaseEndsAt;
      if (typeof s.round === 'number') this.state.round = s.round;
      if (this.pendingReady) {
        this.pendingReady = false;
        this.readyOnce = true;
        this.emit('ready', { ...this.state });
      }
      return;
    }
    for (const e of msg.events) this.play(e);
  }

  private pendingReady = false;
  private readyOnce = false;

  private play(e: GameEvent) {
    this.emit('event', e);
    const p = e.payload as any;
    switch (e.type) {
      case 'phase': {
        const change = p as PhaseChange;
        this.state.phase = change.phase;
        this.state.phaseEndsAt = change.endsAt;
        this.state.round = change.round;
        this.emit('phase', change);
        break;
      }
      case 'round.end':
        this.emit('round.end', p as RoundEnd);
        break;
      case 'points':
        for (const u of (p?.updates ?? []) as PointsUpdate[]) this.emit('points', u);
        break;
      case 'remote':
        if (typeof p?.name === 'string' && p.viewer) this.emit('remote', { name: p.name, data: p.data ?? null, platform: 'web', viewer: p.viewer } as RemoteInput);
        break;
      case 'audience': {
        const ev = toAudience(p);
        if (!ev) break;
        this.emit('audience', ev);
        this.emit(ev.kind, ev as never);
        break;
      }
      case 'action': {
        const event = toAudience(p.event);
        if (!event) break;
        const action: Action = { name: p.name, params: p.params ?? {}, viewer: p.viewer ?? event.viewer, amount: p.amount ?? 1, coins: p.coins ?? 0, event };
        this.emit('action', action);
        for (const fn of this.actionHandlers.get(action.name) ?? []) {
          try {
            fn(action);
          } catch (err) {
            console.error(`[gamelo] erro no handler da ação "${action.name}"`, err);
          }
        }
        break;
      }
    }
  }

  private syncClock(serverNow: number) {
    const sample = serverNow - Date.now();
    // A mensagem chega com atraso: suaviza e favorece as amostras maiores (igual ao overlay do motor).
    this.offset = this.synced ? Math.max(sample, this.offset * 0.9 + sample * 0.1) : sample;
    this.synced = true;
  }
}

/** Evento "audience" do motor → evento do SDK. */
export function toAudience(p: any): AudienceEvent | null {
  if (!p || !KINDS.includes(p.kind)) return null;
  const base = { id: String(p.id ?? ''), platform: p.platform ?? 'sim', viewer: p.viewer, at: Number(p.at ?? Date.now()) };
  switch (p.kind as AudienceKind) {
    case 'chat':
      return { ...base, kind: 'chat', text: String(p.text ?? '') };
    case 'gift': {
      const coins = Number(p.coins ?? 0);
      const count = Number(p.count ?? 1);
      return { ...base, kind: 'gift', giftId: String(p.giftId ?? p.giftName ?? ''), giftName: String(p.giftName ?? ''), coins, count, total: coins * count };
    }
    case 'like':
      return { ...base, kind: 'like', count: Number(p.count ?? 1) };
    default:
      return { ...base, kind: p.kind };
  }
}

/** game.json e demo.json ficam ao lado do index.html (no Vite, em public/). */
async function loadJson<T>(file: string, option: string): Promise<T> {
  const res = await fetch(new URL(file, location.href)).catch(() => null);
  if (!res?.ok) throw new Error(`Não achei o ${file} ao lado do index.html. Coloque o arquivo em public/${file} ou passe \`${option}\` no createLive().`);
  return res.json();
}

const wsUrl = (engine: string, room: string) => {
  const u = new URL('/ws', engine);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('room', room);
  return u.toString();
};

/** WebSocket com a sala, reconectando sozinho (o overlay fica aberto a live inteira). */
function socketTransport(engine: string, room: () => string, status: (s: Status) => void, onGone?: () => Promise<void>): Transport {
  let ws: WebSocket | null = null;
  let closed = false;
  let receive: (msg: ServerMessage) => void = () => {};
  const connect = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl(engine, room()));
    ws.onmessage = (m) => receive(JSON.parse(String(m.data)) as ServerMessage);
    ws.onclose = async (ev) => {
      if (closed) return;
      status('connecting');
      // 4004: a sala não existe (ex.: a de desenvolvimento fechou por falta de overlay); o dev abre outra.
      if (ev.code === 4004 && onGone) await onGone().catch((err) => console.error('[gamelo]', err));
      setTimeout(connect, 2000);
    };
  };
  return {
    async start(r) {
      receive = r;
      connect();
    },
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    async test() {
      throw new Error('Eventos de teste não valem na sala do streamer.');
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}

/** Sala de desenvolvimento: pede a sala para a API com o token e o game.json local. */
function devTransport(engine: string, token: string, manifest: GameManifest, demo: DemoScript, audience: 'sim' | 'none', status: (s: Status) => void, setRoom: (room: string) => void): Transport {
  const api = async (path: string, body: unknown) => {
    const res = await fetch(new URL(path, engine), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`[gamelo] ${data.message ?? `erro ${res.status}`}`);
    return data;
  };
  let room = '';
  const open = async () => {
    room = (await api('/sdk/dev-rooms', { manifest, demo, audience })).room;
    setRoom(room);
  };
  const socket = socketTransport(engine, () => room, status, open);
  return {
    async start(receive) {
      await open();
      await socket.start(receive);
    },
    send: (msg) => socket.send(msg),
    async test(e) {
      await api(`/sdk/dev-rooms/${room}/test`, e);
    },
    close: () => socket.close(),
  };
}

/** Cria o SDK do jogo. */
export function createLive(options: LiveOptions = {}): Live {
  return new Live(options);
}

export type { AudienceKind };
