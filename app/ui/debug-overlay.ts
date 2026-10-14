import type * as THREE from 'three/webgpu';

const MB = 1024 * 1024;

/**
 * Performance HUD (toggle with the backtick key). Keep this working every milestone —
 * it's how we check the budgets in docs/plan.md.
 */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private frames = 0;
  private elapsed = 0;
  private worstMs = 0;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly backend: string,
    private readonly drawnRooms: () => string[],
    private readonly loadedRooms: () => string[],
    private readonly currentRoom: () => string,
  ) {
    this.el = document.createElement('pre');
    this.el.className = 'debug-overlay';
    this.el.hidden = !new URLSearchParams(location.search).has('debug');
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.el.hidden = !this.el.hidden;
    });
  }

  /** Call once per frame, after rendering. */
  update(dt: number) {
    this.frames++;
    this.elapsed += dt;
    this.worstMs = Math.max(this.worstMs, dt * 1000);
    if (this.elapsed < 0.5) return;

    if (!this.el.hidden) {
      const { render, memory } = this.renderer.info;
      const fps = this.frames / this.elapsed;
      this.el.textContent = [
        `${fps.toFixed(0)} fps   worst ${this.worstMs.toFixed(1)} ms`,
        `backend    ${this.backend}`,
        `draw calls ${render.drawCalls}`,
        `triangles  ${render.triangles.toLocaleString()}`,
        `textures   ${memory.textures}  (${(memory.texturesSize / MB).toFixed(1)} MB)`,
        `geometries ${memory.geometries}`,
        `drawn      ${this.drawnRooms().join(', ')}`,
        `loaded     ${this.loadedRooms().join(', ')}`,
        `in         ${this.currentRoom()}`,
      ].join('\n');
    }
    this.frames = 0;
    this.elapsed = 0;
    this.worstMs = 0;
  }
}
