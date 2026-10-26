# @gamelo/sdk

SDK para criar jogos interativos de live na Gamelo. O jogo é uma página web (o overlay que o streamer coloca no OBS ou no TikTok LIVE Studio). O SDK entrega os comentários, presentes, curtidas e seguidores da live, já limpos e com as regras do seu `game.json` aplicadas, e controla a rodada e o cronômetro.

Inspirado no web-sdk da Stake Engine (eventos do "book" com um handler por tipo), mais simples: sem framework obrigatório, sem matemática no servidor. A lógica do jogo roda no navegador.

## Começar

```bash
npx @gamelo/sdk init meu-jogo
cd meu-jogo && npm install
npm run dev
```

Abre o exemplo (cabo de guerra) com o público de mentira do `public/demo.json` e um painel de teste no canto. Nada de servidor nem token para começar.

```ts
import { createLive } from '@gamelo/sdk';

const live = createLive();

live.onAction('pull', (a) => puxar(a.params.team, a.amount));   // regra do game.json
live.on('gift', (g) => mostrar(`${g.viewer.handle} mandou ${g.count}x ${g.giftName}`));
live.on('phase', ({ phase, endsAt }) => mostrarFase(phase, endsAt));
live.on('round.end', ({ winner }) => mostrarVencedor(winner));

await live.start();
```

## Modos

| Modo | Quando | Como liga |
| --- | --- | --- |
| `local` | `npm run dev` sem token, prévia do build no painel | Motor dentro da página, público simulado. |
| `dev` | Testar no motor de verdade | `createLive({ token, engine })` com o token do jogo. Abre uma sala de desenvolvimento com público simulado. |
| `room` | Na live | O link do overlay do streamer abre o seu build com `?room=<chave>&engine=<api>`. Automático. |

O modo é escolhido sozinho (`?room=` na URL → room; `token` → dev; senão local). **Nunca publique o token no build**: use `import.meta.env.DEV` como no exemplo.

## Token do jogo

Cada jogo criado no painel do publisher ganha um token (`lg_...`) na página do jogo, em **Token da API**. Ele abre a sala de desenvolvimento e envia builds pelo terminal. Se vazar, clique em **Gerar outro**: o antigo para de valer na hora.

## Enviar uma versão

```bash
# .env.local: VITE_LIVE_ENGINE=https://sua-api  VITE_LIVE_TOKEN=lg_...
npm run deploy -- --notes "nova arena"
```

Ou `npm run pack` e envie o `game.zip` em **Versões (builds)** no painel. O zip tem o `index.html` na raiz, os arquivos do build, o `game.json` e o `demo.json` (obrigatório: a linha do tempo de eventos de mentira que roda no preview, na revisão e nos testes; formato em [EVENTS.md](./EVENTS.md#demojson-obrigatório)).

## API

| | |
| --- | --- |
| `createLive(options)` | `mode`, `token`, `engine`, `room`, `manifest` (padrão: `./game.json`), `demo` (padrão: `./demo.json`), `audience` (`sim` repete o demo, `none`), `devtools`. |
| `live.start()` | Conecta; resolve com o estado da sala. |
| `live.on(evento, fn)` | `chat`, `gift`, `like`, `follow`, `share`, `join`, `audience`, `action`, `phase`, `round.end`, `ready`, `settings`, `status`, `event`. Devolve a função para parar de ouvir. |
| `live.onAction(nome, fn)` | Ação de uma regra do game.json. |
| `live.state` | `mode`, `status`, `phase`, `round`, `phaseEndsAt`, `settings`, `source`, `saved`. |
| `live.settings` | Ajustes da sala. |
| `live.now()` / `live.timeLeft()` | Hora do servidor e tempo da fase. |
| `live.endRound({ winner })` | Encerra a partida. |
| `live.save(dados)` | Guarda um estado pequeno para recarregar o overlay sem perder o jogo. |
| `live.avatar(url)` | Foto de perfil pelo proxy do motor. |
| `live.test.chat/gift/like/follow/share/join` | Eventos falsos (dev e local). |

O contrato completo dos eventos, com o que cada plataforma manda, está em [EVENTS.md](./EVENTS.md). Regras para desenvolver com IA: [AGENTS.md](./AGENTS.md) e a skill em `skill/live-game/SKILL.md` (o `init` copia as duas para o projeto).

Sem bundler: `<script src="dist/gamelo-sdk.iife.js"></script>` e `GameloSDK.createLive()`.
