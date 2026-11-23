import { SoundEngine } from './audio/SoundEngine';
import { EventBus } from './core/EventBus';
import { UNITS } from './data/defs';
import type { Pt } from './grid/Grid';
import { Fx } from './render/Fx';
import { Renderer } from './render/Renderer';
import { Session, type SimEvents } from './sim/Session';
import { Controller } from './ui/Controller';
import { Panels } from './ui/Panels';

const ENEMY_STEP_DELAY = 0.8;

/**
 * Composition root. Owns the frame loop, DOM input and the pacing of the enemy phase
 * (one enemy at a time so the player can follow what happens). All subscriptions are made
 * once here, so restarting a campaign never duplicates listeners.
 */
export class Game {
  readonly bus = new EventBus<SimEvents>();
  readonly session = new Session(this.bus);
  readonly ctl = new Controller(this.session);
  readonly fx = new Fx(this.bus);
  readonly sound = new SoundEngine();
  readonly renderer: Renderer;
  readonly panels = new Panels();

  screen: 'title' | 'play' = 'title';
  debug = false;
  private log: string[] = [];
  private mouse: Pt = { x: -1, y: -1 };
  private last = 0;
  private time = 0;
  private raf = 0;
  private running = false;
  private enemyTimer = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.sound.bind(this.bus);
    this.bindLog();
    this.bus.on('ENEMY_PHASE', () => {
      this.enemyTimer = 0.7;
      this.ctl.cancel();
    });
    this.bus.on('PLAYER_PHASE', ({ turn }) => this.push(`Turn ${turn}: your move.`));

    this.listen(window, 'keydown', (e) => this.onKey(e));
    this.listen(canvas, 'mousemove', (e) => {
      this.mouse = this.renderer.toLogical(e.clientX, e.clientY);
    });
    this.listen(canvas, 'mousedown', (e) => this.onMouse(e));
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.session.newCampaign();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
    this.renderer.dispose();
    this.bus.clear();
  }

  /** Full campaign restart (R). Fresh state, fx cleared, selection dropped. */
  restart(): void {
    this.session.newCampaign();
    this.ctl.reset();
    this.fx.clear();
    this.log = [];
    this.enemyTimer = 0;
    this.screen = 'play';
  }

  private push(line: string): void {
    this.log.push(line);
    if (this.log.length > 40) this.log.shift();
  }

  private bindLog(): void {
    this.bus.on('EFFECT', (e) => {
      switch (e.t) {
        case 'shot':
          return this.push(`Shot: ${e.weapon}`);
        case 'damage':
          return this.push(`${UNITS[e.kind].name} takes ${e.amount}${e.killed ? ' (down)' : ''}${e.source !== 'shot' ? ` from ${e.source}` : ''}`);
        case 'explosion':
          return this.push('Barrel detonates!');
        case 'status':
          return this.push('Target pinned: -2 move');
        case 'deploy':
          return this.push('Sentry deployed');
        case 'disrupted':
          return this.push('An attack was disrupted');
        default:
          return;
      }
    });
    this.bus.on('UNDO', (e) => this.push(`Undo: ${e.label}`));
    this.bus.on('REDO', (e) => this.push(`Redo: ${e.label}`));
  }

  // ---- input ------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (['Space', 'Tab', 'F1'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.sound.unlock();
    if (e.code === 'F1') {
      this.debug = !this.debug;
      return;
    }
    if (e.code === 'KeyM') {
      this.sound.toggleMute();
      return;
    }
    if (this.screen === 'title') {
      if (e.code === 'Enter' || e.code === 'Space') this.restart();
      return;
    }
    if (e.code === 'KeyR') return this.restart();
    const phase = this.session.phase;
    if (phase === 'cleared') {
      if (e.code === 'Enter') this.session.advance();
      else if (e.code === 'KeyZ') this.session.undo();
      return;
    }
    if (phase === 'won' || phase === 'lost') {
      if (e.code === 'Enter') this.restart();
      return;
    }
    if (phase !== 'player') return;
    if ((e.code === 'KeyZ' && !e.shiftKey) || (e.code === 'KeyZ' && e.ctrlKey)) {
      this.session.undo();
    } else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) this.session.redo();
    else if (e.code === 'Space') this.endTurn();
    else if (e.code === 'Tab') this.ctl.cycle();
    else if (e.code === 'Escape') this.ctl.cancel();
    else if (e.code === 'Digit1') this.ctl.setWeapon(0);
    else if (e.code === 'Digit2') this.ctl.setWeapon(1);
    else if (e.code === 'KeyQ' || e.code === 'KeyG') this.ctl.setMove();
  }

  private endTurn(): void {
    this.ctl.cancel();
    this.session.endTurn();
  }

  private onMouse(e: MouseEvent): void {
    this.sound.unlock();
    const p = this.renderer.toLogical(e.clientX, e.clientY);
    this.mouse = p;
    if (e.button === 2) {
      this.ctl.cancel();
      return;
    }
    const id = this.panels.hit(p.x, p.y);
    if (id) return this.onButton(id);
    if (this.screen !== 'play' || this.session.phase !== 'player') return;
    const t = Renderer.tileAt(p);
    if (t && this.ctl.click(t)) this.sound.click();
  }

  private onButton(id: string): void {
    this.sound.click();
    switch (id) {
      case 'start':
      case 'restart':
        return this.restart();
      case 'next':
        return this.session.advance();
      case 'undo':
        this.session.undo();
        return;
      case 'redo':
        this.session.redo();
        return;
      case 'end':
        return this.endTurn();
      case 'mode:move':
        return this.ctl.setMove();
      default:
        if (id.startsWith('mode:w')) this.ctl.setWeapon(Number(id.slice(6)));
    }
  }

  private listen<K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void): void;
  private listen<K extends keyof HTMLElementEventMap>(t: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void;
  private listen(t: EventTarget, type: string, fn: (e: never) => void): void {
    const h = fn as EventListener;
    t.addEventListener(type, h);
    this.cleanups.push(() => t.removeEventListener(type, h));
  }

  // ---- loop -------------------------------------------------------------------------------

  private frame(now: number): void {
    if (!this.running) return;
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 0.05);
    this.last = now;
    this.time += dt;
    this.fx.update(dt);

    const c = this.renderer.begin();
    if (this.screen === 'title') {
      this.panels.drawTitle(c);
    } else {
      if (this.session.phase === 'enemy') {
        this.enemyTimer -= dt;
        if (this.enemyTimer <= 0) {
          this.session.stepEnemy();
          this.enemyTimer = ENEMY_STEP_DELAY;
        }
      }
      this.ctl.hover = Renderer.tileAt(this.mouse);
      this.ctl.refresh();
      const enemyPhase = this.session.phase === 'enemy';
      this.renderer.draw(this.session, this.ctl, this.fx, { debug: this.debug, time: this.time, playerTurn: this.session.phase === 'player' }, dt);
      this.panels.draw(c, this.session, this.ctl, { debug: this.debug, muted: this.sound.muted, enemyPhase, log: this.log });
    }
    this.renderer.end();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }
}
