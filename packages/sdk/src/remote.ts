// Página de controle remoto do jogo: o espectador abre pelo QR code da live
// e manda comandos para o jogo pelo celular. Mesmo build do jogo, outra página
// (o `remote.page` do game.json).
import { LOCAL_REMOTE_CHANNEL, type LocalRemoteMessage } from './client.ts';

export type RemoteMode = 'room' | 'dev' | 'local';

export interface RemoteOptions {
  /**
   * "room": aberta pelo QR code da live (usa ?remote= e ?engine= da URL).
   * "dev": manda para a sala de desenvolvimento do jogo, com o token do jogo.
   * "local": fala com o jogo aberto em outra aba (modo local), sem servidor.
   * "auto" (padrão): room se a URL tem ?remote=, dev se veio `token`, senão local.
   */
  mode?: RemoteMode | 'auto';
  /** Token da API do jogo, só no desenvolvimento (o mesmo do createLive). Nunca publique no build. */
  token?: string;
  /** Endereço da API. Na live vem do ?engine= da URL. */
  engine?: string;
  /** Intervalo entre as leituras da fase do jogo (padrão 3 s). */
  pollMs?: number;
}

export interface RemoteState {
  mode: RemoteMode;
  /** Nome do jogo. */
  game: string;
  /** Nome do streamer (vazio no desenvolvimento). */
  streamer: string;
  /** false: o streamer desligou o controle (ou o jogo não tem). */
  on: boolean;
  /** Fase da partida: lobby, countdown, playing, result; null com o jogo fechado. */
  phase: string | null;
  /** Apelido escolhido (remote.join). Vazio antes de entrar. */
  nick: string;
  /** Última mensagem de erro (para mostrar na página), ou "". */
  error: string;
}

type Listener = (state: RemoteState) => void;

const DEVICE_KEY = 'gamelo.remote.device';
const NICK_KEY = 'gamelo.remote.nick';

const storage = {
  get(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* aba anônima: vale só nesta página */
    }
  },
};

function deviceId(): string {
  let id = storage.get(DEVICE_KEY);
  if (!id || !/^[\w-]{8,64}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    storage.set(DEVICE_KEY, id);
  }
  return id;
}

/** Erro de um toque, com a mensagem pronta para mostrar (ex.: "Calma! Muitos toques seguidos"). */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Controle remoto. Crie com `createRemote()`, chame `start()`, peça o apelido e
 * chame `join(apelido)`; depois `send('pular')`, `send('mover', { x: 1 })`,
 * `chat('fogo')` ou `like()`. O jogo recebe em `live.on('remote', ...)` (send) ou
 * como comentário e curtida normais (chat, like).
 */
export class Remote {
  readonly state: RemoteState;
  private readonly device: string;
  private readonly listeners = new Set<Listener>();
  private readonly params: URLSearchParams;
  private timer: ReturnType<typeof setInterval> | undefined;
  private channel: BroadcastChannel | null = null;

  constructor(private readonly opts: RemoteOptions = {}) {
    this.params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
    const mode = opts.mode && opts.mode !== 'auto' ? opts.mode : this.params.get('remote') ? 'room' : opts.token ? 'dev' : 'local';
    this.device = deviceId();
    this.state = { mode, game: '', streamer: '', on: true, phase: null, nick: storage.get(NICK_KEY) ?? '', error: '' };
  }

  /** Ouve as mudanças de estado (fase, ligado/desligado, apelido, erro). Devolve a função para parar de ouvir. */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<RemoteState>) {
    Object.assign(this.state, patch);
    for (const fn of this.listeners) fn({ ...this.state });
  }

  private get engine(): string {
    const engine = this.opts.engine ?? this.params.get('engine');
    if (!engine) throw new Error('[gamelo] Sem `engine`: na live ele vem do ?engine= da URL; no desenvolvimento passe createRemote({ engine, token }).');
    return engine;
  }

  private url(action: 'info' | 'send'): string {
    if (this.state.mode === 'dev') return new URL('/sdk/dev-room/remote', this.engine).href;
    const key = encodeURIComponent(this.params.get('remote') ?? '');
    return new URL(action === 'info' ? `/remote/${key}` : `/remote/${key}/send`, this.engine).href;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.state.mode === 'dev' && this.opts.token) h.authorization = `Bearer ${this.opts.token}`;
    return h;
  }

  /** Começa a acompanhar o jogo (fase da partida e se o controle está ligado). */
  async start(): Promise<RemoteState> {
    if (this.state.mode === 'local') {
      if (typeof BroadcastChannel === 'undefined') throw new Error('[gamelo] Este navegador não tem BroadcastChannel para o modo local.');
      this.channel = new BroadcastChannel(LOCAL_REMOTE_CHANNEL);
      this.channel.onmessage = (m) => {
        const msg = m.data as LocalRemoteMessage;
        if (msg?.t === 'state') this.set({ game: msg.game, phase: msg.phase, streamer: 'local' });
      };
      this.channel.postMessage({ t: 'hello' } satisfies LocalRemoteMessage);
      return { ...this.state };
    }
    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? 3000);
    return { ...this.state };
  }

  private async poll() {
    try {
      const res = await fetch(this.url('info'), { headers: this.headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return this.set({ error: data.message ?? `erro ${res.status}`, on: res.status === 404 ? false : this.state.on });
      this.set({ game: data.game ?? '', streamer: data.streamer ?? '', on: !!data.on, phase: data.phase ?? null, error: '' });
    } catch {
      this.set({ error: 'Sem conexão. Tentando de novo…' });
    }
  }

  /** Para de acompanhar o jogo. */
  stop(): void {
    clearInterval(this.timer);
    this.channel?.close();
  }

  /** Entra no jogo com um apelido (letras, números, _ e -, até 16). Fica guardado no aparelho. */
  async join(nick: string): Promise<string> {
    const clean = nick.replace(/^@+/, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 16);
    if (!clean) throw new RemoteError('Escolha um apelido (letras e números).', 400);
    this.set({ nick: clean });
    storage.set(NICK_KEY, clean);
    await this.post({ kind: 'join' }).catch(() => {});
    return clean;
  }

  /** Comando do jogo: chega no jogo em `live.on('remote', ({ name, data, viewer }) => ...)`. `data`: JSON de até 1 KB. */
  send(name: string, data?: unknown): Promise<void> {
    return this.post({ kind: 'input', name, data });
  }

  /** Comentário como se fosse da live; só vale se casar com uma regra de comentário do game.json (e conta na pontuação). */
  chat(text: string): Promise<void> {
    return this.post({ kind: 'chat', text });
  }

  /** Uma curtida, como se fosse da live. */
  like(): Promise<void> {
    return this.post({ kind: 'like' });
  }

  private async post(body: { kind: 'input' | 'chat' | 'like' | 'join'; name?: string; data?: unknown; text?: string }): Promise<void> {
    if (!this.state.nick) throw new RemoteError('Chame remote.join(apelido) antes de mandar comandos.', 400);
    const msg = { device: this.device, nick: this.state.nick, ...body };
    if (this.state.mode === 'local') {
      if (!this.channel) throw new Error('[gamelo] Chame remote.start() antes.');
      this.channel.postMessage({ t: 'send', ...msg } satisfies LocalRemoteMessage);
      return;
    }
    const res = await fetch(this.url('send'), { method: 'POST', headers: this.headers(), body: JSON.stringify(msg) });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.nick && data.nick !== this.state.nick) this.set({ nick: data.nick });
      return;
    }
    const data = await res.json().catch(() => ({}));
    const message = data.message ?? `erro ${res.status}`;
    if (res.status === 403) this.set({ on: false });
    throw new RemoteError(Array.isArray(message) ? message.join(' ') : message, res.status);
  }
}

/** Cria o controle remoto da página de controle do jogo. */
export function createRemote(options: RemoteOptions = {}): Remote {
  return new Remote(options);
}
