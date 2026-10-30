// Painel de teste flutuante (sala de teste): manda comentários, presentes
// e curtidas falsos para a sala, a partir das regras do game.json, e aperta
// os botões do streamer (controls).
import type { Live } from './client.ts';

const css = `
.lsdk{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:260px;font:12px/1.35 system-ui,sans-serif;color:#eee;background:#16171fe6;border:1px solid #ffffff22;border-radius:12px;box-shadow:0 8px 30px #0008;backdrop-filter:blur(6px)}
.lsdk header{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;font-weight:700}
.lsdk header i{width:8px;height:8px;border-radius:50%;background:#888}
.lsdk header i.online{background:#3ddc84}.lsdk header i.connecting{background:#f5c542}
.lsdk header span{margin-left:auto;font-weight:500;color:#aaa}
.lsdk .b{padding:0 10px 10px;display:flex;flex-direction:column;gap:6px}
.lsdk.min .b{display:none}
.lsdk .row{display:flex;flex-wrap:wrap;gap:4px}
.lsdk button{all:unset;cursor:pointer;padding:4px 8px;border-radius:999px;background:#8c67f633;color:#d9ccff;font-size:11px}
.lsdk button:hover{background:#8c67f666}
.lsdk [data-control] button{background:#f5c54233;color:#ffe9a8}.lsdk [data-control] button:hover{background:#f5c54266}
.lsdk form{display:flex;gap:4px}
.lsdk input{flex:1;min-width:0;padding:4px 8px;border-radius:8px;border:1px solid #ffffff22;background:#0005;color:#fff;font:inherit}
.lsdk small{color:#999}
`;

const FAKE_USERS = ['ana', 'bia', 'caio', 'duda', 'enzo', 'fe', 'gui', 'heitor'];
let next = 0;
/** Cada clique vem de uma pessoa diferente, para não cair no intervalo mínimo de comentários por espectador. */
const user = () => FAKE_USERS[next++ % FAKE_USERS.length];

export function mountDevtools(live: Live): void {
  if (document.querySelector('.lsdk')) return;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'lsdk';
  const rules = live.manifest?.interactions ?? [];
  const chats = rules
    .filter((r) => r.on === 'chat')
    .map((r) => r.example ?? r.keywords?.[0])
    .filter((t): t is string => !!t);
  // Presentes com regra própria, os do demo.json e, para faixas sem presente conhecido, um presente com o valor da faixa.
  const demo = live.demo;
  const simGifts = [
    ...(demo?.events ?? []).filter((e) => e.kind === 'gift' && e.gift).map((e) => ({ name: e.gift!, coins: e.coins ?? 1 })),
    ...(demo?.random?.gifts ?? []),
  ];
  const gifts: { name: string; coins: number }[] = [];
  const addGift = (name: string, coins: number) => {
    if (!gifts.some((g) => g.name.toLowerCase() === name.toLowerCase())) gifts.push({ name, coins });
  };
  for (const r of rules.filter((r) => r.on === 'gift')) {
    const name = Array.isArray(r.gift) ? r.gift[0] : r.gift;
    if (name) addGift(name, simGifts.find((g) => g.name.toLowerCase() === name.toLowerCase())?.coins ?? 1);
  }
  for (const g of simGifts) addGift(g.name, g.coins);
  for (const r of rules.filter((r) => r.on === 'gift' && !r.gift && r.minCoins)) {
    if (!gifts.some((g) => g.coins >= r.minCoins!)) addGift(`Presente ${r.minCoins}`, r.minCoins!);
  }
  root.innerHTML = `
    <header><i></i>gamelo · ${live.state.mode}<span>${live.manifest?.name ?? ''}</span></header>
    <div class="b">
      <form><input placeholder="comentário" /><button>enviar</button></form>
      <div class="row" data-control></div>
      <div class="row" data-chat></div>
      <div class="row" data-gift></div>
      <div class="row" data-misc></div>
      <small>Eventos de teste vão pela mesma regra do game.json que a live.</small>
    </div>`;
  const add = (where: string, label: string, run: () => Promise<void>) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => run().catch((err) => console.error(err));
    root.querySelector(`[data-${where}]`)!.appendChild(b);
  };
  // Botões do streamer (controls): os que têm campo perguntam o texto, já com o padrão do game.json.
  for (const c of live.manifest?.controls ?? []) {
    const field = c.input === true ? {} : c.input;
    add('control', `🎛 ${c.label}`, async () => {
      if (c.confirm && !confirm(c.confirm)) return;
      let value: string | undefined;
      if (field) {
        const typed = prompt(c.label, field.value ?? '');
        if (typed === null) return;
        value = typed;
      }
      await live.test.control(c.id, value);
    });
  }
  for (const text of [...new Set(chats)]) add('chat', `💬 ${text}`, () => live.test.chat(text, { user: user() }));
  for (const g of gifts) add('gift', `🎁 ${g.name} (${g.coins})`, () => live.test.gift(g.name, { coins: g.coins, user: user() }));
  add('misc', '❤️ 10 curtidas', () => live.test.like(10, { user: user() }));
  add('misc', '➕ seguir', () => live.test.follow({ user: user() }));
  add('misc', '↗ compartilhar', () => live.test.share({ user: user() }));
  add('misc', '👋 entrar', () => live.test.join({ user: user() }));
  // Controle remoto do game.json: abre a página de controle (no teste ela usa o mesmo token de teste).
  const page = live.manifest?.remote?.page;
  if (page) add('misc', '📱 controle remoto', async () => void window.open(new URL(page, location.href).href, '_blank'));
  const input = root.querySelector('input')!;
  root.querySelector('form')!.onsubmit = (e) => {
    e.preventDefault();
    if (input.value.trim()) void live.test.chat(input.value.trim(), { user: user() });
    input.value = '';
  };
  root.querySelector('header')!.onclick = () => root.classList.toggle('min');
  const dot = root.querySelector('header i')!;
  const paint = () => (dot.className = live.state.status);
  live.on('status', paint);
  paint();
  document.body.appendChild(root);
}
