# Regras para jogos da Gamelo

Este projeto é um jogo de live feito com `@gamelo/sdk`. A página roda como fonte de navegador no OBS ou no TikTok LIVE Studio, por cima da transmissão. Leia `docs/EVENTS.md` (contrato dos eventos) antes de mexer na lógica.

## Arquitetura

- `public/game.json`: manifesto. Nome, tempos da rodada, `settings` (números que o streamer ajusta) e `interactions` (regras que transformam comentários e presentes em ações). Vai na raiz do build.
- `public/demo.json` (**obrigatório**, o upload recusa sem ele): linha do tempo de eventos de mentira (`events` com `at`, `kind`, `user`, `text`/`gift`/`coins`/`count`), `viewers` e, se quiser, `random`. Roda em loop no preview, na revisão do admin, no modo local e na sala de desenvolvimento. Formato em `docs/EVENTS.md`.
- `src/main.ts`: cria o SDK com `createLive()`, guarda o estado do jogo, reage às ações e desenha.
- O motor (servidor) faz: conexão com a live, duplicados, combos de presente, regras do game.json, rodada e cronômetro. O jogo faz: regra do jogo e tela.

## Regras obrigatórias

1. **Reaja a ações, não a textos.** Toda mecânica que vem da audiência passa por uma regra em `interactions` e chega em `live.onAction('nome')`. Não compare `giftName` nem o texto do chat no código: o streamer troca nomes de presentes e faixas de moedas no painel e o jogo precisa continuar funcionando. `live.on('chat')`/`on('gift')` só para feed e efeitos visuais.
2. **Números ajustáveis vão em `settings`** e são lidos com `live.settings.x` na hora de usar (podem mudar no meio da live; ouça `live.on('settings')`). Sem números mágicos de balanceamento no código.
3. **Use o relógio do servidor.** `live.now()` e `live.timeLeft()`, nunca `Date.now()` para cronômetro e fases. A rodada é do motor: ouça `phase` e `round.end`; para acabar antes, `live.endRound({ winner })`.
4. **Nunca coloque o token no build.** Só em `.env.local` e só com `import.meta.env.DEV`. Na live o jogo abre pelo link do overlay (`?room=…&engine=…`), sem token.
5. **Presente nunca vale dinheiro, prêmio ou item fora do jogo.** Nada de sorteio pago, aposta ou "quem mandar mais ganha um pix". É regra da plataforma e das lojas do TikTok.
6. **Funciona em todas as plataformas.** `like`, `share` e `join` só existem no TikTok; a mecânica principal deve depender de `chat` e `gift`. Moedas estão na escala do TikTok (1 ≈ US$ 0,01) em todas.
7. **Overlay transparente, 9:16.** Fundo `transparent` (o exemplo põe a classe `preview` no body fora da sala, para ter fundo na prévia). Deixe livres os ~12% de cima (perfil e espectadores do TikTok) e os ~25% de baixo (chat e presentes da plataforma). Texto grande, com contorno ou sombra, legível no celular.
8. **Aguente a live inteira.** Sem vazamento: remova elementos antigos, limite listas (feed, partículas, jogadores na tela). Centenas de eventos por segundo podem chegar; agrupe efeitos e use `requestAnimationFrame`. Um erro num handler não pode quebrar o jogo.
9. **Sobreviva a recarregar.** Guarde o essencial com `live.save()` (pequeno, JSON) e restaure em `live.on('ready', s => s.saved)`.
10. **Avatares pelo proxy:** `live.avatar(viewer.avatarUrl)`. Sempre tenha um plano B (inicial do @) se a foto não carregar.
11. **Caminhos relativos e tudo empacotado.** `base: './'` no Vite; imagens, sons e fontes dentro do build (nada de CDN que pode cair durante a live).
12. **Mostre o @ de quem fez algo** (`viewer.handle`). Reconhecimento é o que faz a audiência interagir.

## Fluxo de trabalho

- `npm run dev`: modo local com público simulado e painel de teste (canto inferior direito). Use os botões para cada regra.
- Com `.env.local` (`VITE_LIVE_ENGINE`, `VITE_LIVE_TOKEN`), o dev usa a sala de desenvolvimento do motor: é o teste mais fiel.
- `npm run build` precisa passar sem erros de TypeScript.
- `npm run deploy -- --notes "..."` envia a versão; o publisher pede revisão no painel.

## Ao criar ou mudar uma mecânica

1. Adicione/edite a regra em `public/game.json` (`on`, `action`, `params`, `label`, `example`) e os números em `settings` + `settingsInfo` (nome em português para o painel).
2. Trate a ação com `live.onAction` em `src/main.ts`.
3. Inclua no `public/demo.json` eventos que exercitem a regra (com o nome de presente que a regra usa), para o preview e a revisão mostrarem a mecânica.
4. Teste pelo painel de teste e com o público simulado ligado por alguns minutos.
