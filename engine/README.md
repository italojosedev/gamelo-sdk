# engine/

Cópia do motor da Gamelo (`core`, `gateway`, `runtime`, `simulator`), a mesma que roda nas salas do servidor. O SDK usa esse código no **modo local** (`npm run dev` sem token e a prévia do build) para aplicar as regras do `game.json`, juntar combos de presente e controlar a rodada dentro da página. O build do SDK embute esses pacotes no `dist/`; quem instala o `@gamelo/sdk` não precisa deles.

**Não edite aqui.** A fonte é o repositório da plataforma (`packages/*` no live-engine). Depois de mudar o motor lá:

```bash
node scripts/sync-engine.mjs ../live-engine          # copia
node scripts/sync-engine.mjs ../live-engine --check  # só confere
```
