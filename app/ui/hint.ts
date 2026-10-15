/** A short prompt under the crosshair, e.g. "Click to sit". */
export class Hint {
  private readonly el: HTMLElement;
  private text: string | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hint';
    document.body.appendChild(this.el);
  }

  /** `low` moves the prompt to the bottom of the screen, out of the way of what you're looking at. */
  set(text: string | null, low = false) {
    this.el.classList.toggle('low', low);
    if (text === this.text) return;
    this.text = text;
    this.el.textContent = text ?? '';
    this.el.classList.toggle('visible', text !== null);
  }
}
