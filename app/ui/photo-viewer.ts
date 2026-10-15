import type { ExhibitInfo } from '../world/scene-format';
import { contentUrl } from '../world/scene-format';
import { artworkDate, formatDimensions } from '../world/wall-label';

/** Full-screen view of a painting's photograph, with its label details. Click (or Esc) closes it. */
export class PhotoViewer {
  private readonly el: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly caption: HTMLElement;
  private open = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'photo-viewer';
    this.el.innerHTML = `<figure><img alt="" /><figcaption></figcaption></figure><div class="photo-viewer-key">Click to close</div>`;
    this.img = this.el.querySelector('img')!;
    this.caption = this.el.querySelector('figcaption')!;
    document.body.appendChild(this.el);
  }

  get isOpen() {
    return this.open;
  }

  show(info: ExhibitInfo, imagePath: string) {
    this.img.src = contentUrl(imagePath);
    this.img.alt = `${info.title} by ${info.artist}`;
    this.caption.innerHTML = '';
    const line = (cls: string, text: string) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      this.caption.appendChild(span);
    };
    line('photo-viewer-artist', info.artist);
    line('photo-viewer-title', `${info.title}, ${artworkDate(info)}`);
    line('photo-viewer-meta', `${formatDimensions(info.dimensionsCm)} · ${info.license}`);
    this.open = true;
    this.el.classList.add('visible');
  }

  close() {
    this.open = false;
    this.el.classList.remove('visible');
  }
}
