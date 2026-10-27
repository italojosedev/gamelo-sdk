# Muscle Shampoo

Jogo de live feito com `@gamelo/sdk` (criado com `gamelo init`). Um lutador musculoso lava o cabelo no meio da tela.

**Regra única:** o streamer escolhe as palavras em **Ajustes do jogo > Palavras que liberam o shampoo** (padrão `shampoo, xampu, lava`, separadas por vírgula). Cada comentário que contém uma delas (sem diferenciar maiúsculas nem acentos) faz o frasco despejar shampoo na cabeça dele e mostra o @ de quem comentou. A espuma junta: passando do limite ele esfrega rápido, com cara de bravo; ela baixa sozinha e ele volta a ficar calmo. O topo mostra o total de shampoos e os 3 que mais lavaram.

Personagens em Spine 4.2 (`public/assets/lutador`, `public/assets/frasco`, `@esotericsoftware/spine-pixi-v8`). A textura do lutador foi reduzida à metade (2048×1024); o `.atlas` mantém o tamanho original da página e o runtime calcula as coordenadas por ele.

```bash
pnpm --filter muscle-shampoo dev    # sala de teste com o público do public/demo.json (VITE_GAMELO_TEST_TOKEN no .env.local)
pnpm --filter muscle-shampoo pack   # build + game.zip (game.json e demo.json na raiz)
```
