# @gamelo/sdk

SDK para criar jogos interativos de live na Gamelo. O jogo é uma página web (o overlay que o streamer coloca no OBS ou no TikTok LIVE Studio). O SDK entrega os comentários, presentes, curtidas e seguidores da live, já limpos e com as regras do seu `game.json` aplicadas, e controla a rodada e o cronômetro.

Inspirado no web-sdk da Stake Engine (eventos do "book" com um handler por tipo), mais simples: sem framework obrigatório, sem matemática no servidor. A lógica do jogo roda no navegador.

## Começar

```bash
npx @gamelo/sdk init meu-jogo
cd meu-jogo && npm install
npm run dev
```

Antes do `npm run dev`, crie o jogo no painel do publisher da Gamelo e copie o **token de teste** para o `.env.local` (`cp .env.example .env.local`). O jogo abre na **sala de teste** da Gamelo, com o público de mentira do `public/demo.json` e um painel de teste no canto.

```ts
import { createLive } from '@gamelo/sdk';

// Token de teste só no `npm run dev`; na live o jogo abre pelo link do overlay, sem token.
const live = createLive(import.meta.env.DEV ? { token: import.meta.env.VITE_GAMELO_TEST_TOKEN } : {});

live.onAction('pull', (a) => puxar(a.params.team, a.amount));   // regra do game.json
live.on('gift', (g) => mostrar(`${g.viewer.handle} mandou ${g.count}x ${g.giftName}`));
live.on('phase', ({ phase, endsAt }) => mostrarFase(phase, endsAt));
live.on('round.end', ({ winner }) => mostrarVencedor(winner));

await live.start();
```

## Onde o jogo roda

O SDK não traz o motor da Gamelo: o jogo sempre conecta numa sala no servidor.

| Modo | Quando | Como liga |
| --- | --- | --- |
| `test` | `npm run dev` | `createLive({ token })` com o **token de teste**. Abre a sala de teste do jogo: público simulado do demo.json, eventos de teste, pontos e controle remoto, com o seu `game.json` e `demo.json` locais. |
| `room` | Na live, na prévia do build e na demonstração da loja | O link da sala abre o seu build com `?room=<chave>&engine=<api>`. Automático, sem token. |

O modo é escolhido sozinho (`?room=` na URL → room; senão test). A API padrão é `https://api.gamelo.com.br`; para outro ambiente passe `engine` (ou `VITE_GAMELO_API` no exemplo).

## Tokens do jogo

Cada jogo criado no painel do publisher ganha dois tokens, na página do jogo, em **Tokens do SDK**:

| Token | Para que serve | Onde fica |
| --- | --- | --- |
| Teste (`lgt_...`) | Abrir a sala de teste no `npm run dev`. Não envia versões. | `.env.local`: `VITE_GAMELO_TEST_TOKEN=lgt_...`, usado só com `import.meta.env.DEV`. |
| Publicação (`lgp_...`) | Enviar e listar versões (`gamelo deploy`, `gamelo builds`). Não abre a sala de teste. | `.env.local`: `GAMELO_PUBLISH_TOKEN=lgp_...`, **sem** `VITE_`, para nunca entrar no build. |

Se um vazar, clique em **Gerar outro**: o antigo para de valer na hora e o outro token continua igual. O `lg_...` de antes vale como token de publicação.

## Enviar uma versão

```bash
# .env.local: GAMELO_PUBLISH_TOKEN=lgp_...
npm run deploy -- --notes "nova arena"
npx gamelo builds      # versões enviadas e a revisão de cada uma
```

Ou `npm run pack` e envie o `game.zip` em **Versões (builds)** no painel. O zip tem o `index.html` na raiz, os arquivos do build, o `game.json` e o `demo.json` (obrigatório: a linha do tempo de eventos de mentira que roda no preview, na revisão e nos testes; formato em [EVENTS.md](./EVENTS.md#demojson-obrigatório)).

## API

| | |
| --- | --- |
| `createLive(options)` | `mode`, `token` (de teste), `engine`, `room`, `manifest` (padrão: `./game.json`), `demo` (padrão: `./demo.json`), `audience` (`sim` repete o demo, `none`), `devtools`, `remoteQr`. |
| `live.start()` | Conecta; resolve com o estado da sala. |
| `live.on(evento, fn)` | `chat`, `gift`, `like`, `follow`, `share`, `join`, `audience`, `action`, `phase`, `round.end`, `ready`, `settings`, `status`, `event`. Devolve a função para parar de ouvir. |
| `live.onAction(nome, fn)` | Ação de uma regra do game.json. |
| `live.state` | `mode`, `status`, `phase`, `round`, `phaseEndsAt`, `settings`, `source`, `saved`. |
| `live.settings` | Ajustes da sala. |
| `live.now()` / `live.timeLeft()` | Hora do servidor e tempo da fase. |
| `live.endRound({ winner })` | Encerra a partida. |
| `live.save(dados)` | Guarda um estado pequeno para recarregar o overlay sem perder o jogo. |
| `live.avatar(url)` | Foto de perfil pelo proxy da Gamelo. |
| `live.test.chat/gift/like/follow/share/join` | Eventos falsos (sala de teste). |
| `live.addPoints` / `live.viewerPoints` / `live.ranking` | Pontos dos espectadores (na sala de teste ficam na memória da API). |
| `createRemote(options)` | Página de controle remoto (QR code). |

### Cliente da API

`createApi({ token, engine })` tem as chamadas da API da Gamelo prontas, no navegador ou no Node (`import { createApi } from '@gamelo/sdk/api'` num script). O `createLive` e o CLI usam ele por dentro.

| | Token | |
| --- | --- | --- |
| `api.game()` | qualquer um | O jogo do token e o tipo do token. |
| `api.openTestRoom({ manifest, demo, audience })` | teste | Abre (ou reabre) a sala de teste; devolve a chave da sala. |
| `api.test(sala, evento)` | teste | Comentário, presente, curtida… falsos na sala de teste. |
| `api.ranking(sala, n)` / `api.viewerPoints(sala, plataforma, id)` | nenhum | Pontos da sala pela chave. |
| `api.uploadBuild(zip, notas)` | publicação | Envia uma versão nova. |
| `api.builds()` | publicação | Versões enviadas, com a revisão e qual é a atual. |

Erros vêm como `ApiError` com a mensagem em português e o `status` HTTP.

O contrato completo dos eventos, com o que cada plataforma manda, está em [EVENTS.md](./EVENTS.md). Regras para desenvolver com IA: [AGENTS.md](./AGENTS.md) e a skill em `skill/live-game/SKILL.md` (o `init` copia as duas para o projeto).

Sem bundler: `<script src="dist/gamelo-sdk.iife.js"></script>` e `GameloSDK.createLive()`.
