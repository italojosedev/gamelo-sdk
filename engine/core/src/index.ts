// Contrato central do engine. Tudo que entra vem como AudienceEvent; tudo que
// sai do runtime para o overlay é GameEvent (o "book ao vivo", como na Stake).

export type Platform = 'tiktok' | 'youtube' | 'twitch' | 'kick' | 'sim';

export interface Viewer {
  /** Id estável na plataforma (não muda se a pessoa trocar o @). */
  id: string;
  /** O @ exibido na tela. */
  handle: string;
  nickname: string;
  avatarUrl?: string;
}

interface BaseEvent {
  /** Id único do evento, usado para remover duplicados. */
  id: string;
  platform: Platform;
  viewer: Viewer;
  /** Epoch em ms. */
  at: number;
}

export interface ChatEvent extends BaseEvent {
  kind: 'chat';
  text: string;
}

export interface GiftEvent extends BaseEvent {
  kind: 'gift';
  giftId: string;
  giftName: string;
  /** Valor unitário em moedas da plataforma (diamonds no TikTok). */
  coins: number;
  /** Quantas unidades. Já é o total final do combo depois do gateway. */
  count: number;
  /**
   * Combo de presentes: o TikTok reenvia o mesmo presente com contagem
   * acumulada até a sequência acabar. `comboKey` identifica a sequência e
   * `comboEnd` diz se ela terminou. Presentes sem combo vêm com comboEnd=true.
   */
  comboKey?: string;
  comboEnd: boolean;
}

export interface LikeEvent extends BaseEvent {
  kind: 'like';
  count: number;
}

export interface FollowEvent extends BaseEvent {
  kind: 'follow';
}

export interface ShareEvent extends BaseEvent {
  kind: 'share';
}

export interface JoinEvent extends BaseEvent {
  kind: 'join';
}

export type AudienceEvent = ChatEvent | GiftEvent | LikeEvent | FollowEvent | ShareEvent | JoinEvent;
export type AudienceKind = AudienceEvent['kind'];

/** Valor total de um presente em moedas. */
export function giftValue(e: GiftEvent): number {
  return e.coins * e.count;
}

/**
 * Evento emitido pelo runtime. `type` é livre por jogo; o overlay tem um
 * handler por type (gameEventHandlerMap), igual ao bookEventHandlerMap da Stake.
 */
export interface GameEvent<T extends string = string, P = unknown> {
  seq: number;
  at: number;
  type: T;
  payload: P;
}

/**
 * O que o overlay precisa saber da sala ao conectar (e de novo quando o
 * streamer muda os ajustes e a sala reabre). Usado pelo SDK de jogos.
 */
export interface RoomInfo {
  /** Ajustes valendo nesta sala (os do game.json com os do streamer por cima). */
  settings: Record<string, unknown>;
  /** Tempos da rodada. */
  round: { lobbySec: number; countdownSec: number; durationSec: number; resultSec: number };
  /** De onde vem a audiência: tiktok, twitch, youtube, kick, simulator ou nenhuma. */
  source: string;
  /** O último `save` do jogo nesta sala (para continuar depois de recarregar o overlay). */
  saved: unknown;
}

/** Mensagens do servidor para o overlay. */
export type ServerMessage =
  | { t: 'hello'; room: string; game: string; info?: RoomInfo }
  | { t: 'snapshot'; state: unknown; seq: number }
  | { t: 'events'; events: GameEvent[] };

/**
 * Mensagens do overlay para o servidor. Só jogos do SDK (lógica no navegador)
 * usam: encerrar a rodada e guardar um estado pequeno para recarregar.
 */
export type ClientMessage =
  | { t: 'end'; result?: { winner?: string; summary?: unknown } }
  | { t: 'save'; data: unknown };

/** Fonte de eventos da audiência (TikTok, simulador, ...). */
export interface AudienceSource {
  readonly name: string;
  /** Situação da conexão, para o painel (ex.: "conectado à sala 123"). */
  readonly status?: string;
  start(emit: (e: AudienceEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Entrega um token de acesso válido da plataforma (Twitch, YouTube, Kick).
 * Quem guarda e renova é a API; `force` pede um token novo depois de um 401.
 */
export type TokenProvider = (opts?: { force?: boolean }) => Promise<string>;

/**
 * Moedas de cada plataforma convertidas para a mesma escala das moedas do
 * TikTok (1 moeda ≈ 1 centavo de dólar), para as faixas de preço (minCoins)
 * dos jogos valerem em qualquer live.
 */
export const COINS = {
  /** Sub nível 1, 2 e 3 (Twitch) ou sub/membro (Kick, YouTube): preço em centavos de dólar. */
  sub: { '1000': 499, '2000': 999, '3000': 2499 } as Record<string, number>,
  member: 499,
} as const;

/** Um evento da linha do tempo do demo.json. */
export interface DemoEvent {
  /** Segundos desde o começo do loop. */
  at: number;
  kind: AudienceKind;
  /** @ de quem fez (um dos `viewers` ou qualquer nome). */
  user?: string;
  platform?: Exclude<Platform, 'sim'>;
  /** chat */
  text?: string;
  /** gift: nome do presente, valor de 1 unidade e quantas unidades. */
  gift?: string;
  coins?: number;
  count?: number;
}

/**
 * demo.json: o público de mentira do jogo, usado no preview do build, na
 * revisão do admin, no "Testar" da sala e na sala de desenvolvimento do SDK.
 * Obrigatório no zip de todo jogo.
 */
export interface DemoScript {
  /** Espectadores falsos. */
  viewers: { handle: string; nickname?: string; avatarUrl?: string }[];
  /** Linha do tempo repetida em loop. */
  events: DemoEvent[];
  /** Duração do loop em segundos. Padrão: o último evento + 5 s. */
  loopSec?: number;
  /** Público aleatório por cima da linha do tempo (opcional). */
  random?: {
    chatPerSec?: number;
    likesPerSec?: number;
    giftsPerSec?: number;
    messages?: string[];
    gifts?: { name: string; coins: number; weight: number }[];
  };
}
