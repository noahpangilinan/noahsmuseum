/** The round lens frame shown while looking through a magnifier. */
export class Loupe {
  private readonly el: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'loupe';
    document.body.appendChild(this.el);
  }

  setVisible(visible: boolean) {
    this.el.classList.toggle('visible', visible);
  }
}
