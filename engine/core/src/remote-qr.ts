import type { RemoteInfo } from './index.ts';

const ID = 'live-remote-qr';

/**
 * Mostra (ou tira, com null) o QR code do controle remoto por cima do jogo,
 * num canto da tela. Medidas em "unidades de tela 9:16" para ficar igual no
 * OBS e na prévia. Usado pelo SDK de jogos (e pelo overlay do motor).
 */
export function showRemoteQr(remote: RemoteInfo | null | undefined): void {
  if (typeof document === 'undefined') return;
  document.getElementById(ID)?.remove();
  if (!remote || remote.draw === false) return;
  const u = (n: number) => `calc(${n} * min(1vw, 0.5625vh))`;
  const box = document.createElement('div');
  box.id = ID;
  const [v, h] = [remote.corner[0] === 't' ? 'top' : 'bottom', remote.corner[1] === 'l' ? 'left' : 'right'];
  box.style.cssText = [
    'position:fixed',
    `${v}:${u(3)}`,
    `${h}:${u(3)}`,
    `width:${u(remote.size)}`,
    `padding:${u(1.2)}`,
    `border-radius:${u(2)}`,
    'background:#fff',
    'box-shadow:0 6px 24px #0006',
    'z-index:2147483000',
    'pointer-events:none',
    'text-align:center',
  ].join(';');
  const img = document.createElement('img');
  img.src = remote.qr;
  img.alt = remote.url;
  img.style.cssText = 'display:block;width:100%;height:auto;image-rendering:pixelated';
  const label = document.createElement('div');
  label.textContent = remote.label;
  label.style.cssText = `margin-top:${u(0.6)};color:#1b1035;font:800 ${u(Math.max(2.4, remote.size / 9))}/1.15 Nunito,system-ui,sans-serif`;
  box.append(img, label);
  document.body.appendChild(box);
}
