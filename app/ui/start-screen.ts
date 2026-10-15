/**
 * Full-screen overlay: loading status, then "click to enter" (pointer lock needs a user gesture).
 * Reappears whenever the pointer is released.
 */
export class StartScreen {
  private readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly hint: HTMLElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'start-screen';
    this.el.innerHTML = `
      <div class="start-card">
        <h1>Noah's Museum</h1>
        <p class="start-status">Loading…</p>
        <p class="start-hint" hidden>
          Click to enter<br />
          <span>WASD to walk · mouse to look · Shift to run · C to crouch · M for map (click to teleport) · click a bench to sit · click a painting for its label · Esc to release</span>
        </p>
      </div>`;
    document.body.appendChild(this.el);
    this.status = this.el.querySelector('.start-status')!;
    this.hint = this.el.querySelector('.start-hint')!;
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }

  ready(onEnter: () => void) {
    this.status.hidden = true;
    this.hint.hidden = false;
    this.el.classList.add('ready');
    this.el.addEventListener('click', onEnter);
  }

  error(err: unknown) {
    this.el.classList.add('error');
    this.status.hidden = false;
    this.status.textContent = err instanceof Error ? err.message : String(err);
  }

  setVisible(visible: boolean) {
    this.el.classList.toggle('hidden', !visible);
  }
}
