---
name: live-game
description: Cria ou altera jogos interativos de live (TikTok, Twitch, YouTube, Kick) com o @gamelo/sdk — mecânicas a partir de comentários e presentes, game.json, overlay 9:16 e envio de build. Use ao criar um jogo de live, adicionar uma mecânica de presente/comentário ou depurar eventos da live.
---

# Jogo de live com @gamelo/sdk

Siga `AGENTS.md` (regras) e `docs/EVENTS.md` (contrato dos eventos). Resumo do que importa para gerar código certo:

## Esqueleto

```ts
import { createLive } from '@gamelo/sdk';

// npm run dev: sala de teste da Gamelo com o token de teste do .env.local. Na live: link do overlay, sem token.
const live = createLive(
  import.meta.env.DEV ? { token: import.meta.env.VITE_GAMELO_TEST_TOKEN, engine: import.meta.env.VITE_GAMELO_API } : {},
);

// estado do jogo aqui (a lógica roda no navegador)

live.onAction('attack', (a) => { /* a.viewer, a.amount, a.coins, a.params, a.event */ });
live.on('phase', ({ phase, endsAt, round }) => { /* lobby | countdown | playing | result */ });
live.on('round.end', ({ winner }) => { /* winner vazio = acabou por tempo */ });
live.on('ready', (s) => { /* s.saved: restaurar depois de recarregar */ });
live.on('settings', () => { /* releia live.settings */ });
live.on('points', ({ viewer, added, total }) => { /* alguém pontuou (regras do streamer ou addPoints) */ });

await live.start();
```

## Passos para uma mecânica nova

1. **game.json** (`public/game.json`): uma regra por gatilho.
   - comentário exato: `{ "on": "chat", "keywords": ["1","pula"], "action": "jump", "label": "Pular", "example": "pula" }`
   - comentário por padrão: `{ "on": "chat", "match": "^\\W*fogo", "action": "fire" }`
   - presente específico: `{ "on": "gift", "gift": ["Rose","Rosa"], "action": "heal", "params": { "label": "Rosa" } }`
   - faixa de valor: `{ "on": "gift", "minCoins": 100, "action": "boss" }` (vale a maior faixa alcançada pelo valor de 1 unidade)
   - antes da partida: `"phases": ["lobby","playing"]`; anti-spam: `"cooldownMs": 3000`
   - números em `settings` com nome em `settingsInfo`.
2. **Código**: `live.onAction('<action>', fn)`. Força proporcional ao presente: use `a.coins` (total) ou `a.amount` (unidades). Leia ajustes com `Number(live.settings.x ?? padrão)`.
3. **demo.json** (`public/demo.json`, obrigatório no zip): adicione na linha do tempo `events` um evento que dispare a regra, ex.: `{ "at": 6, "kind": "gift", "user": "bia", "gift": "Rose", "coins": 1, "count": 5 }` ou `{ "at": 2, "kind": "chat", "user": "ana", "text": "pula" }`. Em um loop (`loopSec`) o demo deve mostrar todas as mecânicas. `random` (opcional) põe público aleatório por cima.
4. **Testar**: `npm run dev` (sala de teste; precisa do `VITE_GAMELO_TEST_TOKEN` no `.env.local`), botões do painel de teste; `live.test.gift('Rose', { coins: 1, count: 5 })` no console.

## Armadilhas

- Não use `Date.now()` para tempo de jogo: `live.now()` / `live.timeLeft()`.
- `gift.count` é o incremento deste evento (combos já tratados), não o total da sequência.
- O mesmo comentário chega como `chat` e como ação: não aplique a regra nos dois.
- `like`, `share`, `join` só no TikTok. Twitch/YouTube/Kick mandam apoio pago como `gift` ("Bits", "Sub", "Super Chat", "Membro", Kicks) na escala de moedas do TikTok.
- Nunca coloque token no código que vai para o build (teste só com `import.meta.env.DEV`; o de publicação é `GAMELO_PUBLISH_TOKEN`, sem `VITE_`). Nunca dê valor em dinheiro a presentes.
- Não existe modo sem servidor: o SDK não traz o motor. Para chamar a API (sala de teste, pontos, versões) use `createLive`, `createRemote` ou `createApi`, nunca `fetch` na mão.
- Overlay transparente em 9:16; deixe topo (~12%) e base (~25%) livres; limite listas e elementos para aguentar horas.
- `live.endRound()` só funciona em `playing`; `live.save()` aceita até ~60 KB.
- Regras de pontuação são do streamer (painel > Pontuação), não do game.json. O jogo pode dar os pontos dele com `live.addPoints(a, 60)` (passe a ação/evento de quem ganhou; o id do evento evita somar em dobro) e ler os de alguém com `await live.viewerPoints(a)` → `{ points, rank }` (comando "!pontos"). Mostre com `live.on('points')` e `await live.ranking(5)`. Na sala de teste os pontos ficam na memória da API.

## Controle remoto (opcional)

Se o jogo tiver página de controle para o celular do espectador (o streamer liga em Controlar sala e um QR aparece no jogo):

1. `public/game.json`: `"remote": { "page": "controle.html" }` (`"qr": false` se o jogo desenha o QR com `live.remote`).
2. `controle.html` na raiz + `src/controle.ts` com `createRemote()` (token de teste só no dev, igual ao `createLive`); peça o apelido e chame `remote.join(apelido)`, depois `remote.send('nome', dados)`; `remote.chat(texto)` só para textos que casam com uma regra de comentário.
3. No jogo: `live.on('remote', ({ name, data, viewer }) => ...)`.
4. `vite.config.ts`: as duas páginas em `build.rollupOptions.input`. Página mobile, botões grandes, mostre `remote.state.phase` e o aviso de desligado. Detalhes em `docs/EVENTS.md` > Controle remoto.

## Entregar

`npm run build` sem erros → `npm run deploy -- --notes "o que mudou"` (token de publicação no `GAMELO_PUBLISH_TOKEN`) (ou `npm run pack` e enviar o `game.zip` no painel do publisher). O zip leva `game.json` e `demo.json`; sem o demo o envio é recusado.
