// Contrato público do SDK: tudo que o jogo recebe da live e da sala.
// A explicação completa, com o que cada plataforma manda, está em EVENTS.md.

/** De onde veio o evento. `sim` é o público simulado (desenvolvimento e testes). */
export type Platform = 'tiktok' | 'twitch' | 'youtube' | 'kick' | 'sim';

/** Quem fez algo na live. */
export interface Viewer {
  /** Id estável na plataforma (não muda se a pessoa trocar o @). Já vem com prefixo por plataforma quando preciso (tw:, yt:, kk:). */
  id: string;
  /** O @ para mostrar na tela, sem o "@". */
  handle: string;
  /** Nome de exibição. */
  nickname: string;
  /** Foto de perfil. Use `live.avatar(url)` para carregar pelo proxy do motor (evita CORS). */
  avatarUrl?: string;
}

interface BaseEvent {
  /** Id único do evento (duplicados já foram removidos pelo motor). */
  id: string;
  platform: Platform;
  viewer: Viewer;
  /** Hora do evento na plataforma, em ms (epoch). */
  at: number;
}

/** Comentário no chat. */
export interface ChatEvent extends BaseEvent {
  kind: 'chat';
  text: string;
}

/**
 * Presente ou apoio pago. Todas as plataformas usam a escala de moedas do
 * TikTok (1 moeda ≈ US$ 0,01), para as faixas de preço valerem em qualquer live.
 */
export interface GiftEvent extends BaseEvent {
  kind: 'gift';
  /** Id do presente na plataforma (no TikTok, o número do presente; nas outras, o nome). */
  giftId: string;
  /** Nome como a plataforma manda (TikTok em inglês ou português, conforme a conta). */
  giftName: string;
  /** Valor de UMA unidade, em moedas. */
  coins: number;
  /** Quantas unidades chegaram neste evento (combos do TikTok já vêm somados em incrementos). */
  count: number;
  /** coins × count. */
  total: number;
}

/** Curtidas (o TikTok manda em lotes). */
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

/** Alguém entrou na live (só TikTok). */
export interface JoinEvent extends BaseEvent {
  kind: 'join';
}

export type AudienceEvent = ChatEvent | GiftEvent | LikeEvent | FollowEvent | ShareEvent | JoinEvent;
export type AudienceKind = AudienceEvent['kind'];

/**
 * Uma regra do game.json que casou com um evento da audiência. É o jeito
 * recomendado de reagir: o streamer pode trocar nomes de presentes e faixas
 * de moedas no painel sem mexer no código do jogo.
 */
export interface Action {
  /** O `action` da regra (ex.: "attack"). */
  name: string;
  /** Os `params` da regra, já com o que o streamer mudou (ex.: label do presente). */
  params: Record<string, unknown>;
  viewer: Viewer;
  /** Unidades: quantidade do presente, nº de curtidas, 1 para os outros. */
  amount: number;
  /** Valor total em moedas (0 se não for presente). */
  coins: number;
  /** O evento original. */
  event: AudienceEvent;
}

export type Phase = 'lobby' | 'countdown' | 'playing' | 'result';

export interface PhaseChange {
  phase: Phase;
  /** Hora do servidor em que a fase termina (compare com `live.now()`). */
  endsAt: number;
  round: number;
}

export interface RoundEnd {
  round: number;
  winner?: string;
  summary?: unknown;
}

/** Regra do mapa de interações (game.json). */
export interface InteractionRule {
  on: AudienceKind;
  action: string;
  /** chat: regex (sem diferenciar maiúsculas) testada no comentário. */
  match?: string;
  /** chat: o comentário inteiro igual a uma destas palavras. */
  keywords?: string[];
  /** gift: nome ou id do presente, ou lista deles. Vence as faixas de preço. */
  gift?: string | string[];
  /** gift: faixa de preço. Vale a regra com o maior minCoins que o presente alcança. */
  minCoins?: number;
  /** Fases em que a regra vale. Padrão: só "playing". */
  phases?: Phase[];
  /** Intervalo mínimo por espectador. */
  cooldownMs?: number;
  params?: Record<string, unknown>;
  enabled?: boolean;
  /** Como a regra aparece no painel do streamer. */
  label?: string;
  /** chat: comentário de exemplo para os botões de teste. */
  example?: string;
}

/** O game.json do jogo. */
export interface GameManifest {
  id?: string;
  name?: string;
  aspect?: '9:16' | '16:9';
  round?: { lobbySec?: number; countdownSec?: number; durationSec?: number; resultSec?: number };
  interactions?: InteractionRule[];
  settings?: Record<string, unknown>;
  settingsInfo?: Record<string, { label: string; options?: { value: string | number; label: string }[] }>;
}

/** Um evento da linha do tempo do demo.json. */
export interface DemoEvent {
  /** Segundos desde o começo do loop. */
  at: number;
  kind: AudienceKind;
  /** @ de quem fez (um dos `viewers` ou qualquer nome). Sem ele, os viewers se revezam. */
  user?: string;
  platform?: 'tiktok' | 'twitch' | 'youtube' | 'kick';
  /** chat: o comentário. */
  text?: string;
  /** gift: nome do presente. */
  gift?: string;
  /** gift: valor de 1 unidade em moedas. */
  coins?: number;
  /** gift: unidades; like: curtidas. */
  count?: number;
}

/**
 * demo.json (obrigatório no zip): o público de mentira do jogo. A linha do
 * tempo `events` roda em loop no preview do build, na revisão do admin, no
 * modo local e na sala de desenvolvimento; os presentes dela viram os botões
 * de teste do painel.
 */
export interface DemoScript {
  viewers?: { handle: string; nickname?: string; avatarUrl?: string }[];
  events: DemoEvent[];
  /** Duração do loop em segundos. Padrão: último evento + 5 s. */
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

/** Evento cru do protocolo do motor (o "book ao vivo"). */
export interface GameEvent<P = unknown> {
  seq: number;
  at: number;
  type: string;
  payload: P;
}

/** Como o SDK está ligado. */
export type Mode = 'room' | 'dev' | 'local';
export type Status = 'connecting' | 'online' | 'offline';

/** O que o SDK sabe da sala agora. */
export interface RoomState {
  mode: Mode;
  status: Status;
  /** Chave da sala (secreta: não mostre na tela). */
  room: string;
  /** Id do jogo no motor. */
  game: string;
  phase: Phase;
  round: number;
  /** Hora do servidor em que a fase atual termina. */
  phaseEndsAt: number;
  /** Ajustes valendo (game.json + o que o streamer mudou). */
  settings: Record<string, unknown>;
  /** De onde vem a audiência: tiktok, twitch, youtube, kick, simulator ou nenhuma. */
  source: string;
  /** O último `live.save()` desta sala (sobrevive a recarregar o overlay). */
  saved: unknown;
}

/**
 * Pontos que um espectador ganhou agora. O streamer define no painel
 * (Pontuação) quanto vale cada comentário, presente, inscrição ou follow;
 * os pontos somam de live em live até ele zerar.
 */
export interface PointsUpdate {
  platform: Platform;
  viewer: Viewer;
  /** Pontos ganhos neste evento. */
  added: number;
  /** Total acumulado do espectador neste jogo. */
  total: number;
}

/** Uma linha do ranking de pontos da sala (`live.ranking()`). */
export interface RankingEntry {
  rank: number;
  platform: Platform;
  viewer: Viewer;
  points: number;
}

/** Eventos de `live.on(...)`. */
export interface LiveEvents {
  /** Conectou (ou reconectou, ou a sala reabriu com ajustes novos). */
  ready: RoomState;
  status: Status;
  chat: ChatEvent;
  gift: GiftEvent;
  like: LikeEvent;
  follow: FollowEvent;
  share: ShareEvent;
  join: JoinEvent;
  /** Qualquer evento da audiência. */
  audience: AudienceEvent;
  /** Uma regra do game.json casou. */
  action: Action;
  phase: PhaseChange;
  'round.end': RoundEnd;
  /** Um espectador ganhou pontos (só na sala do streamer, com a pontuação ligada no painel). */
  points: PointsUpdate;
  /** Os ajustes mudaram (o streamer salvou no painel). */
  settings: Record<string, unknown>;
  /** Todo GameEvent cru que chega do motor. */
  event: GameEvent;
}
