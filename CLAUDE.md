# gamelo-sdk

Repositório público do `@gamelo/sdk` (biblioteca + CLI `gamelo`) para jogos de live da Gamelo. Textos em português; use "a Gamelo".

- `packages/sdk`: o pacote publicado. `EVENTS.md` é o contrato dos eventos; mudou o contrato, atualize ele, o `AGENTS.md`, a skill `skill/live-game` e o `CHANGELOG.md`.
- `engine/`: cópia do motor do live-engine (privado). Não edite aqui: mude no live-engine e rode `node scripts/sync-engine.mjs ../live-engine`.
- `examples/muscle-shampoo`: jogo de exemplo, usa o SDK do workspace.
- Antes de commitar: `pnpm typecheck && pnpm test && pnpm build`.
- Versão nova: sobe `packages/sdk/package.json` + seção no CHANGELOG, tag `vX.Y.Z` publica pelo workflow.
