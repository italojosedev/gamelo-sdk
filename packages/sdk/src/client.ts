import { GameloApi, type TestEvent } from './api.ts';
import { mountDevtools } from './devtools.ts';
import { showRemoteQr } from './remote-qr.ts';
import type {
  Action,
  AudienceEvent,
  AudienceKind,
  ControlEvent,
  DemoScript,
  GameEvent,
  GameManifest,
  LiveEvents,
  Mode,
  PhaseChange,
  PointsTarget,
  PointsUpdate,
  RankingEntry,
  RemoteInfo,
  RemoteInput,
  RoomState,
  RoundEnd,
  Status,
  Viewer,
  ViewerPoints,
} from './types.ts';

/** Mensagens da sala (mesmo protocolo do overlay da Gamelo). */
export type ServerMessage =
  | { t: 'hello'; room: string; game: string; info?: { settings: Record<string, unknown>; round: unknown; source: string; saved: unknown; remote?: RemoteInfo } }
  | { t: 'snapshot'; state: { now?: number; phase?: string; phaseEndsAt?: number; round?: number }; seq: number }
  | { t: 'events'; events: GameEvent[] };

export type ClientMessage =
  | { t: 'end'; result?: { winner?: string; summary?: unknown } }
  | { t: 'save'; data: unknown }
  | { t: 'points'; add: { platform: string; viewerId: string; points: number; id?: string }[] }
  | { t: 'remote'; data: unknown };

/** Teto dos pontos de uma vez (a sala recusa acima disso). */
const MAX_AWARD = 100_000;
/** Tamanho máximo do estado do controle remoto (shareRemote), em JSON. */
const MAX_SHARED = 2048;

/** Ligação com a sala da Gamelo pelo WebSocket (a do streamer ou a de teste). */
export interface Transport {
  start(receive: (msg: ServerMessage) => void): Promise<void>;
  send(msg: ClientMessage): void;
  test(e: TestEvent): Promise<void>;
  /** Botão do streamer (controls do game.json), só na sala de teste. */
  control(id: string, value?: string): Promise<void>;
  close(): void;
}

export interface LiveOptions {
  /**
   * "room": overlay da sala do streamer (usa ?room= e ?engine= da URL; é como o jogo roda na live e na prévia do build).
   * "test": sala de teste da Gamelo, com o token de teste e o público simulado do demo.json.
   * "auto" (padrão): room se a URL tem ?room=, senão test.
   */
  mode?: Mode | 'auto';
  /**
   * Token de teste do jogo (`lgt_...`, página do jogo no painel do publisher).
   * Só no desenvolvimento: passe com `import.meta.env.DEV ? { token } : {}` para não ir no build.
   */
  token?: string;
  /** Endereço da API da Gamelo. Padrão: https://api.gamelo.com.br; na sala vem do ?engine= da URL. */
  engine?: string;
  /** Chave da sala. Padrão: ?room= da URL. */
  room?: string;
  /** game.json do jogo. Padrão: busca ./game.json ao lado do index.html. */
  manifest?: GameManifest;
  /** demo.json do jogo (eventos do preview). Padrão: busca ./demo.json ao lado do index.html. */
  demo?: DemoScript;
  /** Sala de teste: "sim" repete o demo.json (padrão); "none" deixa só os eventos de teste. */
  audience?: 'sim' | 'none';
  /** Painel de teste flutuante (padrão: ligado na sala de teste, nunca na do streamer). */
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
  /** Eventos falsos para testar (sala de teste). */
  readonly test: {
    chat(text: string, opts?: Omit<TestEvent, 'kind' | 'text'>): Promise<void>;
    gift(name: string, opts?: Omit<TestEvent, 'kind' | 'gift'>): Promise<void>;
    like(count?: number, opts?: Omit<TestEvent, 'kind' | 'count'>): Promise<void>;
    follow(opts?: Omit<TestEvent, 'kind'>): Promise<void>;
    share(opts?: Omit<TestEvent, 'kind'>): Promise<void>;
    join(opts?: Omit<TestEvent, 'kind'>): Promise<void>;
    /** Aperta um botão do streamer (`controls` do game.json), como o "Controle ao vivo do jogo" do painel. */
    control(id: string, value?: string): Promise<void>;
  };
  private readonly handlers = new Map<string, Set<Handler<any>>>();
  private readonly actionHandlers = new Map<string, Set<Handler<Action>>>();
  private readonly controlHandlers = new Map<string, Set<Handler<ControlEvent>>>();
  private transport: Transport | null = null;
  private offset = 0;
  private synced = false;
  private manifestValue: GameManifest | null;
  private demoValue: DemoScript | null;
  private readonly params: URLSearchParams;
  /** Cliente da API (sala de teste, ranking, pontos). */
  readonly api: GameloApi;

  constructor(private readonly opts: LiveOptions = {}) {
    this.params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    const room = opts.room ?? this.params.get('room') ?? '';
    const mode: Mode = opts.mode && opts.mode !== 'auto' ? opts.mode : room ? 'room' : 'test';
    // Na sala o endereço vem do link do overlay (?engine=); no teste, da opção (padrão: a API da Gamelo).
    this.api = new GameloApi({ token: opts.token, engine: (mode === 'room' ? this.params.get('engine') : null) ?? opts.engine ?? (mode === 'room' && typeof location !== 'undefined' ? location.origin : undefined) });
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
      control: async (id, value) => {
        this.assertTest();
        await this.transport!.control(id, value);
      },
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

  /** Ouve um botão do streamer pelo `id` (o `controls` do game.json). */
  onControl(id: string, fn: Handler<ControlEvent>): () => void {
    let set = this.controlHandlers.get(id);
    if (!set) this.controlHandlers.set(id, (set = new Set()));
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
    const { mode } = this.state;
    if (mode === 'room' && !this.state.room) throw new Error('[gamelo] Sem ?room= na URL: abra o jogo pelo link do overlay da sala.');
    if (mode === 'test' && !this.opts.token) {
      throw new Error(
        '[gamelo] Sem ?room= na URL e sem token de teste. No desenvolvimento, coloque VITE_GAMELO_TEST_TOKEN=lgt_... no .env.local (o token de teste fica na página do jogo, no painel do publisher). Na live o jogo abre pelo link do overlay do streamer.',
      );
    }
    this.setStatus('connecting');
    if (mode === 'test') {
      this.manifestValue ??= await loadJson<GameManifest>('game.json', 'manifest');
      this.demoValue ??= await loadJson<DemoScript>('demo.json', 'demo');
      this.transport = testTransport(this.api, this.manifestValue, this.demoValue, this.opts.audience ?? 'sim', (s) => this.setStatus(s), (room) => {
        this.state.room = room;
      });
    } else {
      this.transport = socketTransport(this.api.engine, () => this.state.room, (s) => this.setStatus(s));
    }
    await this.transport.start((msg) => this.receive(msg));
    if (mode === 'test' && (this.opts.devtools ?? true) && typeof document !== 'undefined') mountDevtools(this);
    return ready;
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

  private sharedJson = 'null';

  /**
   * Manda um estado pequeno (JSON de até 2 KB) para as páginas do controle remoto,
   * que leem em `remote.state.shared` (ex.: as letras já testadas, para pintar o
   * teclado no celular). Vale o último mandado; `null` limpa. Os celulares leem a
   * cada poucos segundos, então mande só o que a página precisa.
   */
  shareRemote(data: unknown): void {
    const json = JSON.stringify(data ?? null);
    if (json.length > MAX_SHARED) {
      console.warn(`[gamelo] shareRemote: o estado tem ${json.length} bytes; o máximo é ${MAX_SHARED}`);
      return;
    }
    if (json === this.sharedJson) return;
    this.sharedJson = json;
    this.transport?.send({ t: 'remote', data: data ?? null });
  }

  /** URL da foto de perfil pelo proxy da Gamelo (o navegador do OBS bloqueia as originais por CORS). */
  avatar(url: string | undefined): string | undefined {
    if (!url) return undefined;
    return `${this.api.engine}/avatar?u=${encodeURIComponent(url)}`;
  }

  /**
   * Ranking de pontos dos espectadores nesta sala, do maior para o menor
   * (até 100). Na sala do streamer vem do banco; na sala de teste, dos pontos
   * dados com `addPoints` (ficam na memória da API). Para atualizar ao vivo, ouça `live.on('points', ...)`.
   */
  async ranking(limit = 10): Promise<RankingEntry[]> {
    if (!this.state.room) return [];
    return this.api.ranking(this.state.room, limit);
  }

  /**
   * Dá pontos a um espectador (um acerto, uma vitória). Na sala do streamer
   * eles vão para a pontuação do jogo no banco e somam entre lives, como os
   * das regras do streamer; na sala de teste ficam na memória da API. Chega um
   * evento `points` com o total. Inteiro de 1 a 100 mil, só para quem já mandou
   * algo na sala. Passe o evento, a ação ou o comando remoto de quem ganhou; o
   * `id` do evento (ou o `id` que você passar) conta uma vez só, mesmo com dois overlays abertos.
   */
  addPoints(who: PointsTarget, points: number, id?: string): void {
    const t = target(who);
    const n = Math.floor(Number(points));
    if (!t || !(n >= 1 && n <= MAX_AWARD)) {
      console.warn('[gamelo] addPoints: precisa de quem ganhou (evento, ação ou remote) e de 1 a 100000 pontos');
      return;
    }
    const awardId = id ?? t.id;
    this.transport?.send({ t: 'points', add: [{ platform: t.platform, viewerId: t.viewer.id, points: n, ...(awardId ? { id: String(awardId) } : {}) }] });
  }

  /**
   * Pontos guardados de um espectador neste jogo e a posição dele no ranking,
   * por exemplo para responder um "!pontos" no chat. Na sala do streamer vem
   * do banco (inclui os pontos das regras do streamer e de lives passadas).
   */
  async viewerPoints(who: PointsTarget): Promise<ViewerPoints> {
    const t = target(who);
    if (!t) throw new Error('[gamelo] viewerPoints: passe o evento, a ação ou o comando remoto do espectador');
    if (!this.state.room) return { platform: t.platform, viewer: { id: t.viewer.id }, points: 0, rank: null };
    return this.api.viewerPoints(this.state.room, t.platform, t.viewer.id);
  }

  /** Desconecta. */
  close(): void {
    this.transport?.close();
    this.transport = null;
    this.setStatus('offline');
  }

  private async sendTest(e: TestEvent): Promise<void> {
    this.assertTest();
    await this.transport!.test(e);
  }

  private assertTest() {
    if (!this.transport) throw new Error('Chame live.start() antes');
    if (this.state.mode === 'room') throw new Error('[gamelo] Eventos de teste não valem na sala do streamer: use o "Testar" do painel.');
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

  /** Mensagem da sala → estado e eventos do jogo. Exposto para testes. */
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
      // Sala nova ou reconectada: os celulares voltam a ver o último estado mandado.
      if (this.sharedJson !== 'null') this.transport?.send({ t: 'remote', data: JSON.parse(this.sharedJson) });
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
      case 'control': {
        if (typeof p?.id !== 'string') break;
        const control: ControlEvent = { id: p.id, value: typeof p.value === 'string' ? p.value : null };
        this.emit('control', control);
        for (const fn of this.controlHandlers.get(control.id) ?? []) {
          try {
            fn(control);
          } catch (err) {
            console.error(`[gamelo] erro no handler do botão "${control.id}"`, err);
          }
        }
        break;
      }
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
    // A mensagem chega com atraso: suaviza e favorece as amostras maiores (igual ao overlay da Gamelo).
    this.offset = this.synced ? Math.max(sample, this.offset * 0.9 + sample * 0.1) : sample;
    this.synced = true;
  }
}

/** Plataforma, espectador e id de quem ganha ou consulta pontos (a ação usa o evento dela). */
function target(who: PointsTarget | null | undefined): { platform: string; viewer: Viewer; id?: string } | null {
  const t = who && 'event' in who && who.event ? who.event : (who as { platform: string; viewer: Viewer; id?: string } | null | undefined);
  if (!t || typeof t.platform !== 'string' || !t.viewer?.id) return null;
  return t;
}

/** Evento "audience" da sala → evento do SDK. */
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
      // 4004: a sala não existe (ex.: a de teste fechou por falta de overlay); o teste abre de novo.
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
    async control() {
      throw new Error('Na sala do streamer os botões ficam no painel (Controle ao vivo do jogo).');
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}

/** Sala de teste: abre na API com o token de teste e o game.json e o demo.json locais. */
function testTransport(api: GameloApi, manifest: GameManifest, demo: DemoScript, audience: 'sim' | 'none', status: (s: Status) => void, setRoom: (room: string) => void): Transport {
  let room = '';
  const open = async () => {
    room = (await api.openTestRoom({ manifest, demo, audience })).room;
    setRoom(room);
  };
  const socket = socketTransport(api.engine, () => room, status, open);
  return {
    async start(receive) {
      await open();
      await socket.start(receive);
    },
    send: (msg) => socket.send(msg),
    async test(e) {
      await api.test(room, e);
    },
    async control(id, value) {
      await api.control(room, id, value);
    },
    close: () => socket.close(),
  };
}

/** Cria o SDK do jogo. */
export function createLive(options: LiveOptions = {}): Live {
  return new Live(options);
}

export type { AudienceKind, TestEvent };
