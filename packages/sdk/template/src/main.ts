// Cabo de guerra: exemplo do @gamelo/sdk.
// O chat puxa a corda ("1" azul, "2" rosa), presentes dão puxões fortes,
// curtidas viram torcida. Quem levar o nó até a ponta vence a rodada.
import { createLive, type Action } from '@gamelo/sdk';
import './style.css';

type Team = 'blue' | 'pink';

// No `npm run dev`, abre a sala de teste da Gamelo com o token de teste do .env.local (público simulado do demo.json).
// No build nunca vai token: na live e na prévia o jogo abre pelo link da sala (?room=...&engine=...).
const live = createLive(
  import.meta.env.DEV ? { token: import.meta.env.VITE_GAMELO_TEST_TOKEN, engine: import.meta.env.VITE_GAMELO_API } : {},
);

// ---- estado do jogo (a lógica é do jogo, roda aqui no navegador) ----
let rope = 0; // -goal (azul venceu) … +goal (rosa venceu)
const teamOf = new Map<string, Team>(); // quem já puxou por qual time
const num = (key: string, fallback: number) => Number(live.settings[key] ?? fallback);

// ---- tela ----
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="hud"><h1>CABO DE GUERRA</h1><p>Comente <b class="blue">1</b> ou <b class="pink">2</b> · presente puxa forte</p></div>
  <div class="banner"></div>
  <div class="arena"><div class="track"></div><div class="knot">🪢</div></div>
  <div class="teams"><span class="blue">◀ AZUL</span><span class="pink">ROSA ▶</span></div>
  <div class="feed"></div>`;
const knot = app.querySelector<HTMLDivElement>('.knot')!;
const banner = app.querySelector<HTMLDivElement>('.banner')!;
const feed = app.querySelector<HTMLDivElement>('.feed')!;
if (live.state.mode !== 'room') document.body.classList.add('preview');

function draw() {
  const goal = num('goal', 100);
  knot.style.left = `${50 + (rope / goal) * 50}%`;
}

function log(html: string) {
  const row = document.createElement('div');
  row.innerHTML = html;
  feed.prepend(row);
  while (feed.children.length > 5) feed.lastChild!.remove();
}

function pull(team: Team, force: number) {
  if (live.state.phase !== 'playing') return;
  const goal = num('goal', 100);
  rope = Math.max(-goal, Math.min(goal, rope + (team === 'pink' ? force : -force)));
  draw();
  live.save({ rope }); // se o OBS recarregar, a corda volta onde estava
  if (Math.abs(rope) >= goal) live.endRound({ winner: team === 'pink' ? 'Rosa' : 'Azul' });
}

// ---- eventos da live ----
live.onAction('pull', (a: Action) => {
  const team = a.params.team as Team;
  teamOf.set(a.viewer.id, team);
  pull(team, num('chatPull', 1));
});

live.onAction('boost', (a) => {
  // Presente puxa pelo time de quem mandou (ou pelo lado que está perdendo).
  const team = teamOf.get(a.viewer.id) ?? (rope > 0 ? 'blue' : 'pink');
  pull(team, a.coins * num('coinPull', 2));
  const name = String(a.params.label ?? (a.event.kind === 'gift' ? a.event.giftName : 'presente'));
  log(`🎁 <b>@${a.viewer.handle}</b> mandou ${a.amount}x ${name} pelo time <b class="${team}">${team === 'blue' ? 'azul' : 'rosa'}</b>`);
});

live.onAction('cheer', (a) => log(`❤️ @${a.viewer.handle} curtiu`));

live.on('chat', (e) => {
  if (!['1', '2', 'azul', 'rosa'].includes(e.text.trim().toLowerCase())) log(`💬 @${e.viewer.handle}: ${e.text}`);
});

live.on('phase', ({ phase }) => {
  if (phase === 'countdown') banner.textContent = 'PREPARA…';
  if (phase === 'playing') {
    rope = 0;
    draw();
    banner.textContent = '';
  }
});

live.on('round.end', ({ winner }) => {
  // Acabou por tempo: o motor não sabe quem vence, o jogo decide pela posição da corda.
  const team = winner ?? (rope > 0 ? 'Rosa' : rope < 0 ? 'Azul' : null);
  banner.textContent = team ? `TIME ${team.toUpperCase()} VENCEU!` : 'EMPATE!';
});

live.on('ready', (s) => {
  const saved = s.saved as { rope?: number } | null;
  if (s.phase === 'playing' && typeof saved?.rope === 'number') rope = saved.rope;
  draw();
});

// Cronômetro com a hora do servidor.
setInterval(() => {
  if (live.state.phase === 'playing' && !banner.textContent) {
    const s = Math.ceil(live.timeLeft() / 1000);
    app.querySelector('.hud p')!.innerHTML = `Comente <b class="blue">1</b> ou <b class="pink">2</b> · ${s}s`;
  }
}, 250);

await live.start();
