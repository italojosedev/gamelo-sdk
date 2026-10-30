# Regras para jogos da Gamelo

Este projeto é um jogo de live feito com `@gamelo/sdk`. A página roda como fonte de navegador no OBS ou no TikTok LIVE Studio, por cima da transmissão. Leia `docs/EVENTS.md` (contrato dos eventos) antes de mexer na lógica.

## Arquitetura

- `public/game.json`: manifesto. Nome, tempos da rodada, `settings` (números que o streamer ajusta) e `interactions` (regras que transformam comentários e presentes em ações). Vai na raiz do build.
- `public/demo.json` (**obrigatório**, o upload recusa sem ele): linha do tempo de eventos de mentira (`events` com `at`, `kind`, `user`, `text`/`gift`/`coins`/`count`), `viewers` e, se quiser, `random`. Roda em loop na prévia do build, na demonstração da loja, na revisão do admin e na sala de teste. Formato em `docs/EVENTS.md`.
- `src/main.ts`: cria o SDK com `createLive()`, guarda o estado do jogo, reage às ações e desenha.
- O motor da Gamelo (no servidor, nunca no projeto) faz: conexão com a live, duplicados, combos de presente, regras do game.json, rodada e cronômetro. O jogo faz: regra do jogo e tela. O SDK só conversa com a API (`createLive`, `createRemote`, `createApi`): não escreva `fetch` para a API da Gamelo na mão.

## Regras obrigatórias

1. **Reaja a ações, não a textos.** Toda mecânica que vem da audiência passa por uma regra em `interactions` e chega em `live.onAction('nome')`. Não compare `giftName` nem o texto do chat no código: o streamer troca nomes de presentes e faixas de moedas no painel e o jogo precisa continuar funcionando. `live.on('chat')`/`on('gift')` só para feed e efeitos visuais.
2. **Números ajustáveis vão em `settings`** e são lidos com `live.settings.x` na hora de usar (podem mudar no meio da live; ouça `live.on('settings')`). Sem números mágicos de balanceamento no código.
3. **Use o relógio do servidor.** `live.now()` e `live.timeLeft()`, nunca `Date.now()` para cronômetro e fases. A rodada é do motor: ouça `phase` e `round.end`; para acabar antes, `live.endRound({ winner })`.
4. **Nunca coloque token no build.** O token de teste (`VITE_GAMELO_TEST_TOKEN`) só no `.env.local` e só com `import.meta.env.DEV`; o de publicação (`GAMELO_PUBLISH_TOKEN`, sem `VITE_`) só o `npm run deploy` usa. Na live o jogo abre pelo link do overlay (`?room=…&engine=…`), sem token.
5. **Presente nunca vale dinheiro, prêmio ou item fora do jogo.** Nada de sorteio pago, aposta ou "quem mandar mais ganha um pix". É regra da plataforma e das lojas do TikTok.
6. **Funciona em todas as plataformas.** `like`, `share` e `join` só existem no TikTok; a mecânica principal deve depender de `chat` e `gift`. Moedas estão na escala do TikTok (1 ≈ US$ 0,01) em todas.
7. **Overlay transparente, 9:16.** Fundo `transparent` (o exemplo põe a classe `preview` no body fora da sala, para ter fundo na prévia). Deixe livres os ~12% de cima (perfil e espectadores do TikTok) e os ~25% de baixo (chat e presentes da plataforma). Texto grande, com contorno ou sombra, legível no celular.
8. **Aguente a live inteira.** Sem vazamento: remova elementos antigos, limite listas (feed, partículas, jogadores na tela). Centenas de eventos por segundo podem chegar; agrupe efeitos e use `requestAnimationFrame`. Um erro num handler não pode quebrar o jogo.
9. **Sobreviva a recarregar.** Guarde o essencial com `live.save()` (pequeno, JSON) e restaure em `live.on('ready', s => s.saved)`.
10. **Avatares pelo proxy:** `live.avatar(viewer.avatarUrl)`. Sempre tenha um plano B (inicial do @) se a foto não carregar.
11. **Caminhos relativos e tudo empacotado.** `base: './'` no Vite; imagens, sons e fontes dentro do build (nada de CDN que pode cair durante a live).
12. **Mostre o @ de quem fez algo** (`viewer.handle`). Reconhecimento é o que faz a audiência interagir.

## Fluxo de trabalho

- `npm run dev`: abre a sala de teste da Gamelo (precisa do `VITE_GAMELO_TEST_TOKEN` no `.env.local`), com o público simulado do demo.json e o painel de teste (canto inferior direito). Use os botões para cada regra. Sem o token o `live.start()` falha explicando o que falta: peça o token ao publisher, não invente um modo sem servidor.
- `npm run build` precisa passar sem erros de TypeScript.
- `npm run deploy -- --notes "..."` envia a versão com o `GAMELO_PUBLISH_TOKEN`; `npx gamelo builds` lista as versões. O publisher pede revisão no painel.

## Ao criar ou mudar uma mecânica

1. Adicione/edite a regra em `public/game.json` (`on`, `action`, `params`, `label`, `example`) e os números em `settings` + `settingsInfo` (nome em português para o painel).
2. Trate a ação com `live.onAction` em `src/main.ts`.
3. Inclua no `public/demo.json` eventos que exercitem a regra (com o nome de presente que a regra usa), para o preview e a revisão mostrarem a mecânica.
4. Teste pelo painel de teste e com o público simulado ligado por alguns minutos.

## Pontos dos espectadores

Os pontos de cada espectador ficam no banco da Gamelo, por jogo e streamer, e somam entre lives. O streamer define as regras dele no painel (não vão no `game.json`); o jogo dá os pontos dele com `live.addPoints(acaoOuEvento, n)` (acerto, vitória) e lê os de alguém com `await live.viewerPoints(acaoOuEvento)` (ex.: comando "!pontos"). `live.on('points')` avisa quando alguém pontua e `live.ranking(n)` traz o ranking. Na sala de teste tudo isso fica na memória da API. Detalhes em `docs/EVENTS.md` > Pontuação.

## Botões do streamer (opcional)

Comando que só o streamer pode dar (abrir votação, revelar, mandar aviso) vai em `"controls"` no `game.json`, nunca numa regra de chat (qualquer espectador digitaria): `{ "id": "votacao", "label": "Abrir votação" }`, com `"input"` para mandar um texto junto (`{ "value": "Observem os olhares!", "required": true }`) e `"confirm"` para botões que apagam algo. O streamer aperta no painel (Controle ao vivo do jogo) e o jogo recebe em `live.onControl('votacao', ({ value }) => …)`. No dev, botões 🎛 no painel de teste. Contrato em `docs/EVENTS.md` > Controle ao vivo do jogo.

## Controle remoto (opcional)

Só existe se o `game.json` tiver `"remote": { "page": "controle.html" }` e a página estiver no build. A página usa `createRemote()` (token de teste só no dev; na live a chave vem do QR) e manda `remote.send(nome, dados)`, que o jogo recebe em `live.on('remote')`. No sentido contrário, `live.shareRemote(dados)` (JSON até 2 KB) aparece na página em `remote.state.shared`. Nunca ponha o token no build. Contrato em `docs/EVENTS.md` > Controle remoto.
