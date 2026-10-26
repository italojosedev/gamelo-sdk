// Cliente da API da Gamelo: funções prontas no lugar das requisições na mão.
// Funciona no navegador e no Node (o `gamelo deploy` usa ele).
//
//   const api = createApi({ token: 'lgt_...' });   // token de teste
//   const { room } = await api.openTestRoom({ manifest, demo });
//   await api.test(room, { kind: 'chat', text: '1' });
//
//   const pub = createApi({ token: 'lgp_...' });   // token de publicação
//   await pub.uploadBuild(zip, 'nova arena');
import type { AudienceKind, DemoScript, GameManifest, RankingEntry, ViewerPoints } from './types.ts';

/** Endereço da API da Gamelo. Para outro ambiente (ex.: staging), passe `engine`. */
export const GAMELO_API = 'https://api.gamelo.com.br';

/** Token de teste (`lgt_`, sala de teste) ou de publicação (`lgp_`, envio de versões). */
export type TokenKind = 'test' | 'publish';

/** Evento falso para testar (painel de teste, `live.test.*`, `api.test`). */
export interface TestEvent {
  kind: AudienceKind;
  text?: string;
  gift?: string;
  coins?: number;
  count?: number;
  user?: string;
  platform?: 'tiktok' | 'twitch' | 'youtube' | 'kick' | 'web';
}

export interface ApiOptions {
  /** Token do jogo, da página do jogo no painel do publisher. */
  token?: string;
  /** Endereço da API. Padrão: https://api.gamelo.com.br. */
  engine?: string;
}

/** O jogo dono do token. */
export interface GameInfo {
  slug: string;
  name: string;
  status: 'draft' | 'in_review' | 'published' | 'archived';
  /** Versão atual (a aprovada que os streamers usam), ou null. */
  currentVersion: string | null;
  /** Tipo do token usado. */
  token: TokenKind;
  engine: string;
}

/** Sala de teste aberta. */
export interface TestRoom {
  /** Chave da sala (para o WebSocket em /ws?room=). */
  room: string;
  engine: string;
  game: { slug: string; name: string };
}

/** Uma versão enviada. */
export interface BuildInfo {
  id: number;
  version: string;
  sizeBytes: number;
  notes: string;
  status: 'uploaded' | 'approved' | 'rejected';
  reviewNotes: string | null;
  /** Prévia da versão numa sala com o público do demo.json. */
  previewUrl: string;
  /** É a versão que os streamers usam agora. */
  current: boolean;
  createdAt: string;
  reviewedAt: string | null;
}

/** Erro da API, com a mensagem em português pronta para mostrar. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Cliente da API da Gamelo. O token de teste abre a sala de teste (público
 * simulado, eventos de teste, pontos); o de publicação envia e lista versões.
 * O ranking e os pontos de uma sala não precisam de token: a chave da sala basta.
 */
export class GameloApi {
  readonly engine: string;

  constructor(private readonly opts: ApiOptions = {}) {
    this.engine = (opts.engine || GAMELO_API).replace(/\/+$/, '');
  }

  /** Tipo do token pelo começo dele (null sem token ou com um formato desconhecido). */
  get tokenKind(): TokenKind | null {
    const t = this.opts.token ?? '';
    if (t.startsWith('lgt_')) return 'test';
    if (t.startsWith('lgp_') || t.startsWith('lg_')) return 'publish';
    return null;
  }

  url(path: string): URL {
    return new URL(path, `${this.engine}/`);
  }

  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (auth) {
      if (!this.opts.token) throw new ApiError('Falta o token do jogo (página do jogo no painel do publisher).', 401);
      headers.authorization = `Bearer ${this.opts.token}`;
    }
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(this.url(path), { method, headers, body: payload });
    } catch {
      throw new ApiError(`Sem conexão com a API da Gamelo (${this.engine}).`, 0);
    }
    const data = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    if (!res.ok) {
      const message = Array.isArray(data.message) ? data.message.join('; ') : (data.message ?? `erro ${res.status}`);
      throw new ApiError(message, res.status);
    }
    return data as T;
  }

  /** O jogo do token (serve para conferir se o token vale e de que tipo ele é). */
  game(): Promise<GameInfo> {
    return this.call('GET', '/sdk/game');
  }

  // ---- Sala de teste (token de teste) ----

  /**
   * Abre a sala de teste do jogo com o game.json e o demo.json locais (abrir
   * de novo troca os dois e mantém a sala). "sim" repete o demo.json; "none"
   * deixa só os eventos de teste. A sala fecha sozinha uns minutos depois que
   * o último jogo conectado sai.
   */
  openTestRoom(input: { manifest: GameManifest; demo: DemoScript; audience?: 'sim' | 'none' }): Promise<TestRoom> {
    return this.call('POST', '/sdk/dev-rooms', { manifest: input.manifest, demo: input.demo, audience: input.audience ?? 'sim' });
  }

  /** Comentário, presente, curtida etc. falsos na sala de teste (passam pelas regras do game.json como os da live). */
  async test(room: string, event: TestEvent): Promise<void> {
    await this.call('POST', `/sdk/dev-rooms/${encodeURIComponent(room)}/test`, event);
  }

  // ---- Pontos (qualquer sala, pela chave) ----

  /** Ranking de pontos da sala, do maior para o menor (até 100). */
  async ranking(room: string, limit = 10): Promise<RankingEntry[]> {
    const max = Math.min(Math.max(1, Math.floor(limit)), 100);
    return (await this.call<{ ranking: RankingEntry[] }>('GET', `/sdk/rooms/${encodeURIComponent(room)}/points?limit=${max}`, undefined, false)).ranking;
  }

  /** Pontos de um espectador na sala e a posição dele no ranking. */
  viewerPoints(room: string, platform: string, viewerId: string): Promise<ViewerPoints> {
    const q = new URLSearchParams({ platform, id: viewerId });
    return this.call('GET', `/sdk/rooms/${encodeURIComponent(room)}/points/viewer?${q}`, undefined, false);
  }

  // ---- Versões (token de publicação) ----

  /** Envia o zip do jogo (o mesmo do `gamelo pack`) como versão nova. Depois peça a revisão no painel. */
  uploadBuild(zip: Blob | Uint8Array, notes = ''): Promise<BuildInfo> {
    const form = new FormData();
    const blob = zip instanceof Blob ? zip : new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    form.set('bundle', blob, 'game.zip');
    form.set('notes', notes);
    return this.call('POST', '/sdk/builds', form);
  }

  /** Versões enviadas, da mais nova para a mais antiga, com a situação da revisão. */
  builds(): Promise<BuildInfo[]> {
    return this.call('GET', '/sdk/builds');
  }
}

/** Cria o cliente da API da Gamelo. */
export function createApi(options: ApiOptions = {}): GameloApi {
  return new GameloApi(options);
}
