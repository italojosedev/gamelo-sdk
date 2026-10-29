# Contrato de eventos da live

Tudo que um jogo do `@gamelo/sdk` recebe. O motor da Gamelo (no servidor) conecta na live, remove duplicados, junta combos de presente, aplica as regras do `game.json` e entrega para o jogo pelo WebSocket da sala. O jogo nunca fala direto com o TikTok, a Twitch, o YouTube ou a Kick.

O jogo sempre roda numa sala no servidor: a **sala do streamer** na live (e a de prévia, na prévia do build e na demonstração da loja), aberta pelo link com `?room=`, ou a **sala de teste** no desenvolvimento, aberta com o **token de teste** do jogo (`lgt_...`) e o `game.json` e o `demo.json` locais. Os eventos e o protocolo são os mesmos nas duas.

```
live (TikTok/Twitch/YouTube/Kick) ─► conector ─► gateway ─► regras do game.json ─► WebSocket ─► seu jogo (navegador/OBS)
                                                              (rodada e cronômetro)        ◄── endRound / save
```

## Eventos da audiência

Todos têm a mesma base:

| Campo | Tipo | O que é |
| --- | --- | --- |
| `kind` | `chat` \| `gift` \| `like` \| `follow` \| `share` \| `join` | Tipo do evento. |
| `id` | string | Único. Duplicados já foram removidos. |
| `platform` | `tiktok` \| `twitch` \| `youtube` \| `kick` \| `web` \| `sim` | De onde veio. `web` = controle remoto pelo celular (QR code). `sim` = público simulado ou botão de teste. |
| `viewer.id` | string | Id estável da pessoa na plataforma (Twitch `tw:`, YouTube `yt:`, Kick `kk:`). Use como chave de jogador. |
| `viewer.handle` | string | O @ sem "@". Para mostrar na tela. |
| `viewer.nickname` | string | Nome de exibição. |
| `viewer.avatarUrl` | string? | Foto. Carregue com `live.avatar(url)` (proxy do motor; o OBS bloqueia a original por CORS). |
| `at` | number | Hora do evento em ms (epoch). |

| `kind` | Campos próprios | Ouça com |
| --- | --- | --- |
| `chat` | `text`: o comentário (emotes da Kick já viram o nome) | `live.on('chat')` |
| `gift` | `giftId`, `giftName`, `coins` (valor de 1 unidade), `count` (unidades neste evento), `total` (`coins × count`) | `live.on('gift')` |
| `like` | `count`: curtidas neste lote | `live.on('like')` |
| `follow` | — | `live.on('follow')` |
| `share` | — | `live.on('share')` |
| `join` | — | `live.on('join')` |

`live.on('audience')` recebe todos os tipos.

### Moedas

Todas as plataformas usam a escala de moedas do TikTok: **1 moeda ≈ US$ 0,01**. Assim uma faixa `"minCoins": 100` vale para um presente de 100 moedas do TikTok, 100 bits da Twitch ou um Super Chat de US$ 1.

### Combos do TikTok

O TikTok reenvia o mesmo presente com a contagem acumulada enquanto a pessoa segura o botão. O motor transforma isso em incrementos: cada evento `gift` traz só as unidades **novas** em `count`. Some os eventos; nunca trate `count` como total da sequência.

## O que cada plataforma manda

| Evento | TikTok | Twitch | YouTube Live | Kick |
| --- | --- | --- | --- | --- |
| `chat` | comentário | mensagem do chat | mensagem do chat | mensagem do chat |
| `gift` | presentes (nome e id reais, `coins` = diamantes) | Bits (`giftName` "Bits", 1 moeda por bit); sub "Sub" / "Sub nível 2" / "Sub nível 3" (499 / 999 / 2499); "Sub de presente" (`count` = quantos); "Resub" | "Super Chat" e "Super Sticker" (valor convertido para centavos de dólar); "Membro" (499); "Membros de presente" (`count` = quantos); "Membro (renovação)" | "Sub" e "Resub" (499); "Sub de presente" (`count` = quantos); Kicks (nome do Kick, 1 moeda por Kick) |
| `like` | sim (em lotes) | — | — | — |
| `follow` | sim | sim | — | sim |
| `share` | sim | — | — | — |
| `join` | sim | — | — | — |

Na Twitch, no YouTube e na Kick o `giftId` é igual ao `giftName` (exceto Kicks, que trazem o tipo). Um jogo que depende de `like`, `share` ou `join` precisa de outra forma de jogar nas outras plataformas: prefira mecânicas de `chat` e `gift`, que existem em todas.

## Ações (regras do game.json)

Uma **ação** é uma regra do mapa de interações que casou com um evento. É o jeito recomendado de reagir, porque o streamer muda nomes de presentes, faixas de moedas e ajustes no painel sem mexer no código.

```json
{ "on": "chat", "keywords": ["1", "azul"], "action": "pull", "params": { "team": "blue" } }
{ "on": "chat", "match": "^\\W*(f+o+g+o+|🔥)", "action": "shot" }
{ "on": "gift", "gift": ["Rose", "Rosa", "5655"], "action": "heal", "params": { "label": "Rosa" } }
{ "on": "gift", "minCoins": 100, "action": "boss" }
{ "on": "like", "action": "cheer", "cooldownMs": 2000 }
```

| Campo | O que faz |
| --- | --- |
| `on` | Tipo de evento: `chat`, `gift`, `like`, `follow`, `share`, `join`. |
| `action` | Nome da ação que chega no jogo. Várias regras podem ter a mesma ação. |
| `keywords` | chat: o comentário inteiro igual a uma das palavras (sem diferenciar maiúsculas, ignora espaços nas pontas). |
| `match` | chat: expressão regular testada no comentário (sem diferenciar maiúsculas). |
| `gift` | gift: nome ou id, ou lista deles (o TikTok pode mandar o nome em inglês, em português ou só o id). Regra com `gift` sempre vence as faixas. |
| `minCoins` | gift: faixa de preço. Vale a regra com o **maior** `minCoins` que o valor de 1 unidade alcança. |
| `phases` | Fases em que vale. Padrão: só `["playing"]`. Use `["lobby","playing"]` para aceitar entrada antes da partida. |
| `cooldownMs` | Intervalo mínimo por espectador nesta regra. |
| `params` | Vão junto na ação. `params.label` num presente é o nome dele na tela (o streamer pode trocar). |
| `label` | Como a regra aparece no painel do streamer. |
| `example` | chat: comentário de exemplo para os botões de teste. |
| `enabled` | `false` desliga a regra. |

Ordem: no chat vale a **primeira** regra que casar; no presente, regra com nome primeiro, senão a maior faixa alcançada. Um evento gera no máximo uma ação.

A ação chega assim (`live.onAction('pull', fn)` ou `live.on('action', fn)`):

| Campo | O que é |
| --- | --- |
| `name` | O `action` da regra. |
| `params` | Os `params` da regra (já com o que o streamer mudou). |
| `viewer` | Quem fez. |
| `amount` | Unidades: quantidade do presente, nº de curtidas, 1 nos outros. |
| `coins` | Valor total do presente em moedas (`coins × count`); 0 nos outros. |
| `event` | O evento da audiência completo. |

O mesmo evento chega **duas vezes** se você ouvir os dois: como evento (`on('chat')`) e como ação (`onAction`). Use o evento para o feed/visual e a ação para a regra do jogo.

## Rodada e cronômetro

O motor controla a rodada, igual para todos os overlays: `lobby` → `countdown` → `playing` → `result` → de novo. Os tempos vêm de `round` no game.json (`lobbySec`, `countdownSec`, `durationSec`, `resultSec`; padrão 0 / 3 / 300 / 5).

| Evento | Payload |
| --- | --- |
| `phase` | `{ phase, endsAt, round }`. `endsAt` é hora do servidor: compare com `live.now()`. |
| `round.end` | `{ round, winner?, summary? }`. Sem `winner` quando acabou por tempo: o jogo decide o que mostrar. |

`live.endRound({ winner, summary })` encerra a partida antes do tempo (só vale em `playing`). Para um jogo sem fim, use um `durationSec` longo (até 31 dias).

## Sala

| | |
| --- | --- |
| `ready` | Conectou, reconectou ou a sala reabriu (o streamer salvou ajustes). Traz o `RoomState`. |
| `settings` | Os ajustes mudaram. Releia `live.settings`. |
| `status` | `connecting`, `online` ou `offline`. O SDK reconecta sozinho. |
| `live.settings` | `settings` do game.json com o que o streamer mudou no painel. |
| `live.save(dados)` / `live.state.saved` | Estado pequeno (até ~60 KB) guardado na sala para o jogo continuar se o overlay recarregar. Some quando a sala fecha (2 min sem overlay e sem transmissão conectada). |
| `live.state.source` | `tiktok`, `twitch`, `youtube`, `kick`, `simulator` ou `nenhuma`. |
| `event` | Todo GameEvent cru (`{ seq, at, type, payload }`), para depurar. |

## Pontuação dos espectadores

Cada espectador tem pontos por jogo e por streamer, guardados no banco da Gamelo. Eles somam de uma live para outra até o streamer zerar no painel (**Pontuação**), onde ele também vê o ranking. Os pontos chegam de dois jeitos:

- **Regras do streamer**: ele define no painel quanto vale cada coisa (ex.: comentar "fogo" = 1 ponto, uma Rose = 10, sub ou follow = 10). O jogo não precisa fazer nada para esses contarem. Não peça essas regras no `game.json`.
- **O próprio jogo**: `live.addPoints` dá pontos por um acerto, uma vitória etc. Valem mesmo sem regras ligadas no painel.

| | |
| --- | --- |
| `points` | Alguém ganhou pontos agora (pelas regras ou pelo `addPoints`): `{ platform, viewer, added, total }` (`total` = acumulado no jogo). |
| `live.addPoints(quem, pontos, id?)` | Dá pontos (inteiro de 1 a 100 000) a quem mandou um evento. `quem` é o evento da live, a ação (`onAction`) ou o comando do controle remoto. Só vale para quem já passou pela sala. O mesmo `id` conta uma vez (padrão: o `id` do evento), então dois overlays abertos não somam em dobro; passe um `id` seu para dar mais de um prêmio pelo mesmo evento. |
| `live.viewerPoints(quem)` | Pontos guardados de um espectador neste jogo e a posição dele: `{ platform, viewer, points, rank }`. Sem pontos ainda: `points` 0 e `rank` null. Serve para responder um "!pontos" no chat. |
| `live.ranking(limit = 10)` | Ranking do jogo, do maior para o menor (até 100): `[{ rank, platform, viewer, points }]`. |

```ts
live.onAction('palavra', (a) => {
  if (acertou(a.event.text)) live.addPoints(a, 60);
});
live.onAction('pontos', async (a) => {
  const { points, rank } = await live.viewerPoints(a);
  mostrar(`@${a.viewer.handle}: ${points} pontos${rank ? ` (#${rank})` : ''}`);
});
live.on('points', ({ viewer, added, total }) => showToast(`@${viewer.handle} +${added} (${total})`));
const top = await live.ranking(5);
```

Na sala do streamer tudo vai para o banco. Na sala de teste (e na de prévia de um build) os pontos ficam só na memória da API, somem quando ela reinicia (`addPoints`, `viewerPoints` e `ranking` funcionam igual, para testar a tela) e as regras do streamer não existem.

## Controle remoto (QR code)

O jogo pode trazer uma **página de controle**, que o espectador abre no celular pelo QR code que aparece no jogo, quando o streamer liga em "Controlar sala". A página é sua, vai no mesmo zip do jogo e só existe se o `game.json` declarar:

```json
"remote": { "page": "controle.html", "qr": true, "label": "Jogue pelo celular" }
```

| Campo | O que faz |
| --- | --- |
| `page` | Página de controle dentro do build. O envio é recusado se ela não estiver no zip. |
| `qr` | `true` (padrão): o SDK desenha o QR no canto escolhido pelo streamer. `false`: o jogo desenha com `live.remote` (`qr` = imagem SVG, `url`, `corner`, `size`, `label`). |
| `label` | Texto padrão embaixo do QR (até 30 letras); o streamer pode trocar. |

Na página de controle, `createRemote()`:

- **test**: `createRemote({ token })` manda para a sala de teste do jogo, com o token de teste (só no `npm run dev`).
- **room**: aberta pelo QR, a URL traz `?remote=<chave>&engine=<API>`; a chave é pública e só controla aquela sala (o streamer pode trocar o link). Nunca ponha token no build.

| Na página | Chega no jogo como |
| --- | --- |
| `remote.join(apelido)` | `join` (platform `web`). Obrigatório antes dos outros. |
| `remote.send(nome, dados)` | `live.on('remote', ({ name, data, viewer }) => …)`; `data` é JSON de até 1 KB; `viewer.id` = `web:<aparelho>`. |
| `remote.chat(texto)` | Comentário normal (platform `web`): passa pelas regras e pela pontuação. Só aceita texto que casa com uma regra de comentário. |
| `remote.like()` | Curtida normal (platform `web`). |

`remote.state` traz `game`, `streamer`, `on` (o streamer ligou), `phase` (null com o jogo fechado), `shared`, `nick` e `error`; `remote.onChange(fn)` avisa quando muda.

Do jogo para os celulares: `live.shareRemote(dados)` guarda na sala um estado pequeno (JSON de até 2 KB; vale o último, `null` limpa) que as páginas de controle leem em `remote.state.shared` junto com a fase, a cada `pollMs` (padrão 3 s, mínimo 1 s). Serve para a página mostrar o que importa do jogo, por exemplo as letras já testadas para pintar o teclado. O SDK só manda quando muda e manda de novo quando a sala reconecta. Limite por aparelho: 1 toque a cada 100 ms e 50 a cada 10 s. Presentes não passam pelo controle.

## demo.json (obrigatório)

Todo zip de jogo precisa de um `demo.json` na raiz, ao lado do `game.json`. É o público de mentira do jogo: uma linha do tempo de eventos que roda em loop na **prévia do build**, na **demonstração da loja**, na **revisão do admin** e na **sala de teste**. Os presentes dele também viram os botões de teste do painel. Um zip sem `demo.json` válido é recusado com a mensagem do erro.

```json
{
  "loopSec": 40,
  "viewers": [{ "handle": "ana", "nickname": "Ana" }, { "handle": "bia" }],
  "events": [
    { "at": 1, "kind": "chat", "user": "ana", "text": "1" },
    { "at": 6, "kind": "gift", "user": "bia", "gift": "Rose", "coins": 1, "count": 5 },
    { "at": 9, "kind": "like", "count": 20 },
    { "at": 15, "kind": "follow", "user": "ana" },
    { "at": 30, "kind": "gift", "gift": "Galaxy", "coins": 1000, "platform": "tiktok" }
  ],
  "random": {
    "chatPerSec": 2, "likesPerSec": 1, "giftsPerSec": 0.2,
    "messages": ["1", "2", "bora"],
    "gifts": [{ "name": "Rose", "coins": 1, "weight": 70 }, { "name": "Doughnut", "coins": 30, "weight": 8 }]
  }
}
```

| Campo | O que é |
| --- | --- |
| `events` | **Obrigatório**, pelo menos 1 (até 2000). Cada um: `at` (segundos desde o começo do loop), `kind` e os campos do tipo: `text` no chat; `gift` e `coins` (valor de 1 unidade) no presente; `count` opcional no presente e na curtida; `user` (o @, sem ele os `viewers` se revezam) e `platform` opcionais. |
| `viewers` | Espectadores de mentira (`handle`, `nickname`, `avatarUrl`). |
| `loopSec` | Duração do loop. Padrão: o último evento + 5 s. |
| `random` | Opcional: público aleatório por cima da linha do tempo (`chatPerSec`, `likesPerSec`, `giftsPerSec` até 50; `messages`; `gifts` com `name`, `coins`, `weight`). |

Monte a linha do tempo para mostrar o jogo inteiro em um loop: cada regra do `game.json` acontecendo pelo menos uma vez, com os presentes pelos nomes que as regras usam. Se o streamer renomear um presente no painel, o demo passa a mandar o nome novo. O editor valida com `"$schema": "../node_modules/@gamelo/sdk/demo.schema.json"`.

## Protocolo (para quem não usa o SDK)

WebSocket em `<engine>/ws?room=<chave>`. O servidor manda JSON:

- `{ "t": "hello", "room", "game", "info": { "settings", "round", "source", "saved", "remote" } }` (`remote` só com o controle remoto ligado)
- `remote` em `events`: comando da página de controle, payload `{ name, data, platform: "web", viewer }`, `seq` 0
- `{ "t": "snapshot", "state": { "now", "phase", "phaseEndsAt", "round", "seq" }, "seq" }` (a cada mudança e pelo menos 1 vez por segundo)
- `{ "t": "events", "events": [{ "seq", "at", "type", "payload" }] }` com `type` = `audience`, `action`, `phase`, `round.end`, `points` (payload `{ updates: [{ platform, viewer, added, total }] }`, `seq` 0)

O jogo pode mandar `{ "t": "end", "result": { "winner" } }`, `{ "t": "save", "data": … }`, `{ "t": "remote", "data": … }` (estado do controle remoto, até 2 KB, volta como `shared` em `GET <engine>/remote/<chave>`) e `{ "t": "points", "add": [{ "platform", "viewerId", "points", "id" }] }` (até 50 por mensagem). O ranking da sala está em `GET <engine>/sdk/rooms/<chave>/points?limit=10` e os pontos de um espectador em `GET <engine>/sdk/rooms/<chave>/points/viewer?platform=<plataforma>&id=<viewer.id>`.

### API com token (o `createApi` faz por você)

`<engine>` é `https://api.gamelo.com.br`. Mande `Authorization: Bearer <token>`. Token do tipo errado volta 403 com a mensagem do que usar.

| Rota | Token | O que faz |
| --- | --- | --- |
| `GET /sdk/game` | qualquer um | `{ slug, name, status, currentVersion, token: "test" \| "publish", engine }` |
| `POST /sdk/dev-rooms` | teste | Corpo `{ manifest, demo, audience: "sim" \| "none" }`. Abre (ou reabre) a sala de teste do jogo: `{ room, engine, game }`. Conecte em `/ws?room=<room>`. |
| `POST /sdk/dev-rooms/<room>/test` | teste | Evento falso: `{ kind, text?, gift?, coins?, count?, user?, platform? }`. |
| `GET` / `POST /sdk/dev-room/remote` | teste | Fase e `shared` da sala de teste / toque da página de controle no teste (corpo igual ao `POST /remote/<chave>/send`). |
| `POST /sdk/builds` | publicação | `multipart/form-data` com `bundle` (o zip) e `notes`: envia uma versão. |
| `GET /sdk/builds` | publicação | Versões enviadas: `[{ id, version, status, notes, reviewNotes, previewUrl, current, createdAt }]`. |
