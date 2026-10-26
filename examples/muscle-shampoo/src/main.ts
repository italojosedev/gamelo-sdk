// Muscle Shampoo: o streamer escolhe as palavras (Ajustes do jogo > "Palavras que liberam o
// shampoo"). Cada comentário com uma delas faz o frasco despejar shampoo na cabeça do lutador.
// Muita espuma junta = ele esfrega rápido e fica bravo; a espuma baixa sozinha e ele acalma.
import { createLive } from '@gamelo/sdk';
import { View } from './view';
import './style.css';

// No `npm run dev`, abre a sala de teste da Gamelo com o token de teste do .env.local (público simulado do demo.json).
// No build nunca vai token: na live e na prévia o jogo abre pelo link da sala (?room=...&engine=...).
const live = createLive(
  import.meta.env.DEV ? { token: import.meta.env.VITE_GAMELO_TEST_TOKEN, engine: import.meta.env.VITE_GAMELO_API } : {},
);

// ---- estado do jogo ----
let foam = 0; // 0..100
let total = 0;
const helpers = new Map<string, { handle: string; count: number }>();
const num = (key: string, fallback: number) => {
  const v = Number(live.settings[key] ?? fallback);
  return Number.isFinite(v) ? v : fallback;
};

/** Minúsculas e sem acento, para "Xampú" valer como "xampu". */
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** As palavras vêm dos ajustes da sala (o streamer muda no painel), separadas por vírgula. */
function words(): string[] {
  return String(live.settings.palavras ?? 'shampoo')
    .split(',')
    .map(norm)
    .filter(Boolean);
}

// ---- tela ----
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="hud">
    <h1>MUSCLE <span>SHAMPOO</span></h1>
    <p class="call"></p>
    <ol class="top"><li class="total"></li></ol>
  </div>
  <div class="meter"><i></i><span>🫧</span></div>
  <div class="floats"></div>`;
if (live.state.mode !== 'room') document.body.classList.add('preview');

const $ = <T extends Element>(sel: string) => app.querySelector<T>(sel)!;
const floats = $<HTMLDivElement>('.floats');
const topList = $<HTMLOListElement>('.top');
const view = new View();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function drawCall() {
  const list = String(live.settings.palavras ?? 'shampoo')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 2);
  $<HTMLElement>('.call').innerHTML = `Comente ${list.map((w) => `<b>${esc(w.toUpperCase())}</b>`).join(' ou ')} pra lavar o cabelo`;
}

function drawTop() {
  topList.innerHTML = `<li class="total">🧴 ${total}</li>` + [...helpers.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((h, i) => `<li><span>${['🥇', '🥈', '🥉'][i]}</span>@${esc(h.handle)} <small>${h.count}</small></li>`)
    .join('');
}

function float(text: string) {
  if (floats.childElementCount >= 10) floats.firstChild!.remove();
  const el = document.createElement('div');
  el.textContent = text;
  el.style.left = `${view.head.x + 6 + Math.random() * 10}%`;
  el.style.top = `${view.head.y + Math.random() * 4}%`;
  floats.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

// ---- eventos da live ----
// A regra do game.json manda todo comentário como `comentario`; quem decide se tem a palavra
// é o jogo, porque a lista de palavras é um ajuste que o streamer edita no painel.
live.onAction('comentario', (a) => {
  if (a.event.kind !== 'chat') return;
  const text = norm(a.event.text);
  if (!words().some((w) => text.includes(w))) return;
  total++;
  const h = helpers.get(a.viewer.id) ?? { handle: a.viewer.handle, count: 0 };
  h.count++;
  helpers.set(a.viewer.id, h);
  foam = Math.min(100, foam + num('espumaPorShampoo', 14));
  view.pour();
  float(`🧴 @${a.viewer.handle}`);
  drawTop();
});

/** Ajuste "Mostrar a logo do jogo": 1 mostra, 0 esconde (o resto do topo sobe). */
function drawLogo() {
  $<HTMLElement>('.hud h1').hidden = num('mostrarLogo', 1) === 0;
}

live.on('settings', () => {
  drawCall();
  drawLogo();
});

live.on('ready', (s) => {
  const saved = s.saved as { total?: number; helpers?: [string, { handle: string; count: number }][] } | null;
  if (saved) {
    total = Number(saved.total ?? 0);
    helpers.clear();
    for (const [id, h] of saved.helpers ?? []) helpers.set(id, h);
  }
  drawCall();
  drawLogo();
  drawTop();
});

// ---- laço: a espuma baixa sozinha; a cara dele segue a espuma ----
let last = live.now();
let savedAt = 0;
let shown = 0;
function frame() {
  try {
    const now = live.now();
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    foam = Math.max(0, foam - num('espumaCaiPorSegundo', 5) * dt);
    const limit = num('espumaBravo', 60);
    // Histerese: fica bravo no limite e só acalma bem abaixo dele, para não piscar.
    if (foam >= limit) view.setAngry(true);
    else if (foam < limit * 0.6) view.setAngry(false);
    shown += (foam - shown) * Math.min(1, dt * 8);
    $<HTMLElement>('.meter i').style.height = `${shown}%`;
    if (now - savedAt > 2000) {
      savedAt = now;
      live.save({ total, helpers: [...helpers.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20) });
    }
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

drawCall();
drawLogo();
drawTop();
await view.init(app);
requestAnimationFrame(frame);
await live.start();
