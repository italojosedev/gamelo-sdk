# gamelo-sdk

Repositório público do `@gamelo/sdk` (biblioteca + CLI `gamelo`) para jogos de live da Gamelo. Textos em português; use "a Gamelo".

- `packages/sdk`: o pacote publicado. `EVENTS.md` é o contrato dos eventos; mudou o contrato, atualize ele, o `AGENTS.md`, a skill `skill/live-game` e o `CHANGELOG.md`.
- O SDK é só cliente: o motor fica no live-engine (privado) e nunca vem para cá. A API que o SDK chama (sala de teste, pontos, builds) mora em `apps/api/src/sdk` lá.
- `examples/muscle-shampoo`: jogo de exemplo, usa o SDK do workspace.
- Antes de commitar: `pnpm typecheck && pnpm test && pnpm build`.
- Versão nova: sobe `packages/sdk/package.json` + seção no CHANGELOG, tag `vX.Y.Z` publica pelo workflow.
