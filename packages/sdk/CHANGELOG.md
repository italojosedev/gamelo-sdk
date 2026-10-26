# Changelog

Todas as mudanças do `@gamelo/sdk`. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [versionamento semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- Pontos dados pelo jogo: `live.addPoints(quem, pontos, id?)` grava na pontuação do jogo do streamer (soma entre lives, cada `id` uma vez) e `live.viewerPoints(quem)` lê os pontos e a posição de um espectador, por exemplo para um comando "!pontos". Em dev e local ficam na memória da página, e `live.ranking()` passa a mostrar esses pontos lá também. Precisa do motor com a mensagem `points` e a rota `/sdk/rooms/<chave>/points/viewer`.
- Controle remoto por QR code: o jogo declara `remote.page` no `game.json` e leva a própria página de controle no zip; a página usa `createRemote()` (token do jogo no dev, link público do QR na live) e os toques chegam ao jogo como eventos `remote`. Veja a seção do controle remoto no `EVENTS.md`.

## [0.1.0] - 2026-10-26

Primeira versão pública, separada do repositório da plataforma. Antes se chamava `@live-engine/sdk` (nunca foi publicado no npm).

### Adicionado

- `createLive()` com os modos `room` (na live, pelo link do overlay), `dev` (sala de desenvolvimento com o token do jogo) e `local` (motor dentro da página com o público do `demo.json`).
- Eventos da audiência (`chat`, `gift`, `like`, `follow`, `share`, `join`), ações das regras do `game.json` (`onAction`), rodada (`phase`, `round.end`, `endRound`), ajustes da sala, `save()`, `avatar()`, pontuação da audiência e o painel de teste.
- CLI `gamelo`: `init` (modelo, `AGENTS.md`, skill `live-game` e `docs/EVENTS.md`), `pack` (`game.zip` com `game.json` e `demo.json` na raiz) e `deploy` (envia uma versão nova).
- Schemas `game.schema.json` e `demo.schema.json`.
- Build para `<script>` sem bundler: `dist/gamelo-sdk.iife.js` com `window.GameloSDK`.

### Mudou (para quem usava o `@live-engine/sdk` dentro do monorepo)

- Pacote `@live-engine/sdk` → `@gamelo/sdk`.
- CLI `live-sdk` → `gamelo` (`npm run pack` e `npm run deploy` dos projetos chamam `gamelo pack` / `gamelo deploy`).
- `dist/live-sdk.iife.js` / `window.LiveSDK` → `dist/gamelo-sdk.iife.js` / `window.GameloSDK`.
- `$schema` do `game.json` e do `demo.json`: `../node_modules/@gamelo/sdk/...`.

[Não lançado]: https://github.com/italojosedev/gamelo-sdk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/italojosedev/gamelo-sdk/releases/tag/v0.1.0
