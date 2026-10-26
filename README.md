<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-fundo-escuro.svg">
    <img src=".github/assets/logo.svg" alt="Gamelo" height="72">
  </picture>
</p>

<p align="center"><b>SDK para criar jogos interativos de live na Gamelo.</b><br>
TikTok, Twitch, YouTube Live e Kick: o público joga pelos comentários e presentes.</p>

---

O jogo é uma página web: o overlay que o streamer coloca no OBS ou no TikTok LIVE Studio, por cima da transmissão. O `@gamelo/sdk` entrega os comentários, presentes, curtidas e seguidores da live já limpos (sem duplicados, com os combos do TikTok resolvidos e as regras do seu `game.json` aplicadas) e controla a rodada e o cronômetro. A lógica do jogo roda no navegador; você usa o framework que quiser.

## Começar

```bash
npx @gamelo/sdk init meu-jogo
cd meu-jogo && npm install
npm run dev
```

Abre um exemplo (cabo de guerra) com público de mentira e um painel de teste no canto. Não precisa de servidor nem de token para começar.

```ts
import { createLive } from '@gamelo/sdk';

const live = createLive();

live.onAction('pull', (a) => puxar(a.params.team, a.amount));   // regra do game.json
live.on('gift', (g) => mostrar(`${g.viewer.handle} mandou ${g.count}x ${g.giftName}`));
live.on('phase', ({ phase, endsAt }) => mostrarFase(phase, endsAt));

await live.start();
```

Quando estiver pronto, crie o jogo no painel do publisher da Gamelo, cole o token em `.env.local` e rode `npm run deploy`. O passo a passo está no [README do pacote](packages/sdk/README.md).

## O que tem aqui

| Pasta | O que é |
| --- | --- |
| [`packages/sdk`](packages/sdk) | O pacote `@gamelo/sdk`: a biblioteca (`createLive`), o CLI `gamelo` (`init`, `pack`, `deploy`), os schemas do [`game.json`](packages/sdk/game.schema.json) e do [`demo.json`](packages/sdk/demo.schema.json) e o modelo que o `init` copia. |
| [`packages/sdk/EVENTS.md`](packages/sdk/EVENTS.md) | O contrato dos eventos: o que cada plataforma manda, as regras do `game.json`, a rodada e o `demo.json`. |
| [`packages/sdk/AGENTS.md`](packages/sdk/AGENTS.md) e [`skill/live-game`](packages/sdk/skill/live-game/SKILL.md) | Regras e skill para desenvolver o jogo com IA (Claude Code, Cursor, Codex…). O `init` coloca as duas no seu projeto. |
| [`examples/muscle-shampoo`](examples/muscle-shampoo) | Um jogo de verdade feito com o SDK: comentários com uma palavra despejam shampoo num lutador (Spine + Pixi). |
| [`engine`](engine) | Cópia do motor da Gamelo que o modo local usa. Vem do repositório da plataforma; não edite aqui. |

## Desenvolver o SDK

Precisa de Node 22 e pnpm 10.

```bash
pnpm install
pnpm test          # testes do SDK e do motor
pnpm typecheck
pnpm build         # gera packages/sdk/dist
pnpm example       # roda o Muscle Shampoo em modo local
```

## Versões

O SDK segue [versionamento semântico](https://semver.org/lang/pt-BR/). Enquanto estiver em `0.x`, uma versão `0.(x+1).0` pode quebrar compatibilidade; o [CHANGELOG](packages/sdk/CHANGELOG.md) diz o que mudou e como atualizar.

Para lançar uma versão:

1. Suba a versão em `packages/sdk/package.json` e escreva a seção dela no `packages/sdk/CHANGELOG.md`.
2. Faça o commit na `main` e crie a tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. O workflow **Publicar no npm** testa, gera o build e publica o `@gamelo/sdk` (precisa do segredo `NPM_TOKEN` no repositório e da organização `gamelo` no npm).

## Licença

[MIT](LICENSE).
