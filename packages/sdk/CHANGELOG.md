# Changelog

Todas as mudanças do `@gamelo/sdk`. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem o [versionamento semântico](https://semver.org/lang/pt-BR/).

## [0.3.0] - 2026-10-28

### Adicionado

- Estado do jogo para o controle remoto: `live.shareRemote(dados)` guarda na sala um JSON de até 2 KB que as páginas de controle leem em `remote.state.shared` (a cada `pollMs`, agora com mínimo de 1 s). O SDK só manda quando o estado muda e repete ao reconectar. Usado pelo Termelo para pintar o teclado do celular com as letras já testadas. Precisa da API com a mensagem `remote` e o campo `shared` em `GET /remote/<chave>` e `GET /sdk/dev-room/remote`.

## [0.2.0] - 2026-10-26

O SDK passa a ser só cliente: o motor da Gamelo não vem mais no pacote. No desenvolvimento o jogo roda na **sala de teste** da Gamelo, aberta com o **token de teste**; versões vão com o **token de publicação**.

### Quebra compatibilidade

- Sai o modo `local` (o motor dentro da página) e o modo `dev` vira `test`. `createLive()` sem `?room=` na URL abre a sala de teste e precisa do `token` de teste (`lgt_...`); sem ele, `start()` explica o que falta. O mesmo vale para `createRemote()` (sai o `BroadcastChannel` do modo local).
- Dois tokens por jogo no painel do publisher, em **Tokens do SDK**: o de teste (`lgt_`) só abre a sala de teste; o de publicação (`lgp_`) só envia versões. O `lg_` de antes vale como de publicação.
- Variáveis do projeto: `VITE_LIVE_TOKEN` e `VITE_LIVE_ENGINE` → `VITE_GAMELO_TEST_TOKEN` (teste, só com `import.meta.env.DEV`), `GAMELO_PUBLISH_TOKEN` (deploy, sem `VITE_`, o CLI recusa com `VITE_`) e `VITE_GAMELO_API` (opcional). Atualize o `.env.local` e o `createLive` como no `.env.example` e no `src/main.ts` do modelo.
- A API padrão é `https://api.gamelo.com.br`; `engine` só é preciso para outro ambiente.
- Pontos na sala de teste (`addPoints`, `viewerPoints`, `ranking`) ficam na memória da API, não mais na da página.
- A prévia do build no painel e a demonstração da loja rodam numa sala no servidor (modo `room`), não mais no modo local.

### Adicionado

- `createApi({ token, engine })` (também em `@gamelo/sdk/api`, para scripts no Node): `game()`, `openTestRoom()`, `test()`, `ranking()`, `viewerPoints()`, `uploadBuild()` e `builds()`, com erros `ApiError` em português. `createLive` e o CLI usam ele por dentro; `live.api` dá acesso ao cliente do jogo.
- CLI: `gamelo builds` lista as versões enviadas, a revisão de cada uma e qual é a atual; `gamelo deploy` mostra o link da prévia.
- Pontos dados pelo jogo: `live.addPoints(quem, pontos, id?)` grava na pontuação do jogo do streamer (soma entre lives, cada `id` uma vez) e `live.viewerPoints(quem)` lê os pontos e a posição de um espectador, por exemplo para um comando "!pontos". Precisa do motor com a mensagem `points` e a rota `/sdk/rooms/<chave>/points/viewer`.
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

[0.2.0]: https://github.com/italojosedev/gamelo-sdk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/italojosedev/gamelo-sdk/releases/tag/v0.1.0
