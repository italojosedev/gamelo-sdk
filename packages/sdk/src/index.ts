// @gamelo/sdk: o jogo recebe a live (comentários, presentes, curtidas…)
// e fala com a sala da Gamelo. Contrato dos eventos em EVENTS.md.
export { createLive, Live, toAudience, type LiveOptions, type TestEvent } from './client.ts';
export * from './types.ts';
export { createRemote, Remote, RemoteError, type RemoteMode, type RemoteOptions, type RemoteState } from './remote.ts';
export { ApiError, createApi, GAMELO_API, GameloApi, type ApiOptions, type BuildInfo, type GameInfo, type TestRoom, type TokenKind } from './api.ts';
