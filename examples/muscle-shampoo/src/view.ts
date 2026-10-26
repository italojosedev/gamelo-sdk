// Tela em Pixi: o lutador lavando o cabelo e o frasco que despeja o shampoo (Spine 4.2).
// Tudo é desenhado em 450x800 (9:16) e escalado para o tamanho do #app.
import { Application, Assets, Container, type Texture } from 'pixi.js';
import { AtlasAttachmentLoader, SkeletonJson, Spine, SpineTexture, TextureAtlas, type SkeletonData } from '@esotericsoftware/spine-pixi-v8';

export const W = 450;
export const H = 800;

/** Os pés do lutador (origem do esqueleto) e a altura dele na tela. */
const FEET = { x: W / 2, y: 598 };
const LUTADOR_H = 332;
/**
 * O frasco aparece acima e à esquerda da cabeça: no `pour` ele tomba para a direita e o jato
 * sai ~0,48h à direita e cai ~0,53h abaixo da origem, bem no cabelo.
 */
const FRASCO = { x: 163, y: 222, h: 130 };

async function loadSkeleton(name: string, scale: number): Promise<SkeletonData> {
  // Caminhos relativos ao index.html: os arquivos ficam em public/assets e vão na raiz do build.
  const base = `./assets/${name}/${name === 'lutador' ? 'lutador-shampoo' : 'frasco-shampoo'}`;
  const [json, atlasText, png] = await Promise.all([
    fetch(`${base}.json`).then((r) => r.json()),
    fetch(`${base}.atlas`).then((r) => r.text()),
    // Texturas com alfa pré-multiplicado (pma: true no .atlas). A do lutador foi reduzida à
    // metade; o .atlas continua com o tamanho original da página e o runtime calcula as
    // coordenadas por ele, então a animação não muda.
    Assets.load<Texture>({ src: `${base}.png`, data: { alphaMode: 'premultiplied-alpha' } }),
  ]);
  const atlas = new TextureAtlas(atlasText);
  for (const page of atlas.pages) page.setTexture(SpineTexture.from(png.source));
  const reader = new SkeletonJson(new AtlasAttachmentLoader(atlas));
  reader.scale = scale;
  return reader.readSkeletonData(json);
}

export class View {
  private app = new Application();
  private stage = new Container();
  private lutador!: Spine;
  private frasco!: Spine;
  private angry = false;
  private pouring = false;
  private queued = 0;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({ backgroundAlpha: 0, antialias: true, resizeTo: host, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.classList.add('stage');
    host.prepend(this.app.canvas);
    this.app.stage.addChild(this.stage);

    const [lutador, frasco] = await Promise.all([loadSkeleton('lutador', LUTADOR_H / 1700), loadSkeleton('frasco', FRASCO.h / 700)]);
    this.lutador = new Spine(lutador);
    this.lutador.position.set(FEET.x, FEET.y);
    this.lutador.state.data.defaultMix = 0.2;
    this.lutador.state.setAnimation(0, 'idle', true);
    this.frasco = new Spine(frasco);
    this.frasco.position.set(FRASCO.x, FRASCO.y);
    this.frasco.state.setAnimation(0, 'idle', true);
    this.frasco.alpha = 0;
    this.frasco.state.addListener({
      complete: (entry) => {
        if (entry.animation?.name !== 'pour') return;
        this.pouring = false;
        this.next();
      },
    });
    this.stage.addChild(this.lutador, this.frasco);

    const fit = () => {
      const s = this.app.screen.width / W;
      this.stage.scale.set(s);
    };
    fit();
    this.app.renderer.on('resize', fit);
    // O frasco só aparece enquanto despeja.
    this.app.ticker.add((t) => {
      const target = this.pouring ? 1 : 0;
      this.frasco.alpha += (target - this.frasco.alpha) * Math.min(1, t.deltaMS / 120);
    });
  }

  /** Mais um shampoo: o frasco despeja; se já está despejando, entra na fila e acelera. */
  pour(): void {
    if (!this.frasco) return;
    this.queued = Math.min(this.queued + 1, 3);
    if (!this.pouring) this.next();
  }

  private next(): void {
    if (this.queued <= 0) {
      this.frasco.state.setAnimation(0, 'idle', true);
      return;
    }
    this.queued--;
    this.pouring = true;
    const entry = this.frasco.state.setAnimation(0, 'pour', false);
    // Fila cheia (muita gente comentando): despeja mais rápido.
    entry.timeScale = 1 + this.queued * 0.5;
  }

  /** Muita espuma = esfrega rápido, com cara de bravo; pouca = calmo. */
  setAngry(angry: boolean): void {
    if (!this.lutador || angry === this.angry) return;
    this.angry = angry;
    const st = this.lutador.state;
    st.setAnimation(0, angry ? 'to-scrub-fast' : 'to-idle', false);
    st.addAnimation(0, angry ? 'scrub-fast' : 'idle', true, 0);
  }

  /** Onde o jato cai (topo da cabeça), em % da tela, para os @ que sobem dali. */
  get head(): { x: number; y: number } {
    return { x: ((FRASCO.x + FRASCO.h * 0.48) / W) * 100, y: ((FRASCO.y + FRASCO.h * 0.53) / H) * 100 };
  }

}
