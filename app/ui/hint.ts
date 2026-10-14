/** A short prompt under the crosshair, e.g. "Click to sit". */
export class Hint {
  private readonly el: HTMLElement;
  private text: string | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hint';
    document.body.appendChild(this.el);
  }

  set(text: string | null) {
    if (text === this.text) return;
    this.text = text;
    this.el.textContent = text ?? '';
    this.el.classList.toggle('visible', text !== null);
  }
}
