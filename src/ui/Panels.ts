import { UNITS, WEAPONS } from '../data/defs';
import { ROOMS } from '../data/defs';
import type { Candidate, FactorBreakdown, Unit } from '../sim/State';
import { livingUnits } from '../sim/State';
import type { Session } from '../sim/Session';
import { squadMove } from '../sim/Turn';
import { H, PANEL_W, PANEL_X, W } from '../render/Layout';
import { BODY, HEAD, MONO, PAL, UNIT_COLOR } from '../render/Palette';
import type { Controller } from './Controller';

export interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Screen = 'title' | 'play';

function txt(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string = PAL.ink, align: CanvasTextAlign = 'left', font = BODY, weight = 700): void {
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.fillText(s, x, y);
}

function head(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string = PAL.ink, align: CanvasTextAlign = 'left'): void {
  txt(c, s, x, y, size, color, align, HEAD, 900);
}

function card(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = PAL.paper): void {
  c.fillStyle = PAL.shadow;
  c.fillRect(x + 6, y + 7, w, h);
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  c.strokeStyle = PAL.ink;
  c.lineWidth = 3.5;
  c.strokeRect(x, y, w, h);
}

const FACTORS: { key: keyof FactorBreakdown; label: string }[] = [
  { key: 'flank', label: 'Cover/Flank' },
  { key: 'damage', label: 'Damage' },
  { key: 'kill', label: 'Kill' },
  { key: 'synergy', label: 'Synergy' },
  { key: 'exposure', label: 'Exposure' },
  { key: 'friendlyFire', label: 'FriendlyFire' },
  { key: 'advance', label: 'Advance' },
];

/** Side panel, menus and the F1 AI inspector. Rebuilds its clickable button list every frame. */
export class Panels {
  buttons: Button[] = [];

  draw(c: CanvasRenderingContext2D, session: Session, ctl: Controller, opts: { debug: boolean; muted: boolean; enemyPhase: boolean; log: string[] }): void {
    this.buttons = [];
    c.save();
    c.shadowBlur = 0;
    this.drawSide(c, session, ctl, opts);
    if (opts.debug) this.drawInspector(c, session, ctl);
    const p = session.phase;
    if (p === 'cleared') this.drawCleared(c, session);
    else if (p === 'won') this.drawEnd(c, session, true);
    else if (p === 'lost') this.drawEnd(c, session, false);
    c.restore();
  }

  hit(x: number, y: number): string | null {
    for (const b of this.buttons) if (x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h) return b.id;
    return null;
  }

  private button(c: CanvasRenderingContext2D, id: string, label: string, x: number, y: number, w: number, h: number, o: { enabled?: boolean; primary?: boolean; sub?: string } = {}): void {
    const enabled = o.enabled !== false;
    if (enabled) this.buttons.push({ id, x, y, w, h });
    c.fillStyle = PAL.shadow;
    c.fillRect(x + 4, y + 5, w, h);
    c.fillStyle = !enabled ? '#bdb394' : o.primary ? PAL.ink : PAL.paper;
    c.fillRect(x, y, w, h);
    c.strokeStyle = PAL.ink;
    c.lineWidth = 3;
    c.strokeRect(x, y, w, h);
    head(c, label, x + w / 2, y + h / 2 - (o.sub ? 5 : 0), h > 40 ? 20 : 14, !enabled ? PAL.inkSoft : o.primary ? PAL.paper : PAL.ink, 'center');
    if (o.sub) txt(c, o.sub, x + w / 2, y + h / 2 + 13, 11, o.primary ? PAL.kraft : PAL.inkSoft, 'center');
  }

  private drawSide(c: CanvasRenderingContext2D, session: Session, ctl: Controller, o: { debug: boolean; muted: boolean; enemyPhase: boolean; log: string[] }): void {
    const s = session.state;
    const x = PANEL_X;
    head(c, 'BREACH', x, 56, 40, PAL.paper);
    head(c, 'PROTOCOL', x + 196, 56, 40, PAL.mustard);
    txt(c, `ROOM ${s.room + 1}/${ROOMS.length} · ${ROOMS[s.room].name.toUpperCase()}`, x, 92, 15, PAL.paper);
    txt(c, `TURN ${s.turn} · ${o.enemyPhase ? 'ENEMY PHASE' : s.phase === 'player' ? 'YOUR MOVE' : s.phase.toUpperCase()}`, x, 114, 13, o.enemyPhase ? PAL.orange : PAL.kraft);

    // squad cards
    const squad = s.units.filter((u) => u.team === 'player');
    let y = 138;
    for (const u of squad) {
      if (!u.alive) continue;
      this.unitCard(c, u, x, y, ctl.selectedId === u.id);
      y += u.kind === 'turret' ? 52 : 74;
    }
    for (const u of squad) {
      if (u.alive) continue;
      txt(c, `${UNITS[u.kind].name.toUpperCase()}: DOWN`, x + 8, y + 10, 13, PAL.brick);
      y += 22;
    }

    // selected unit: weapons
    const sel = ctl.selected;
    const by = 140 + 3 * 74 + 62;
    if (sel && sel.team === 'player' && s.phase === 'player' && !o.enemyPhase) {
      const def = UNITS[sel.kind];
      const moveOk = !sel.moved && !sel.acted;
      this.button(c, 'mode:move', 'MOVE', x, by, 96, 44, { enabled: moveOk, primary: ctl.mode.kind === 'move' && moveOk, sub: `${squadMove(sel)} tiles` });
      def.weapons.forEach((wid, i) => {
        const w = WEAPONS[wid];
        this.button(c, `mode:w${i}`, `${i + 1} ${wid.toUpperCase()}`, x + 104 + i * 150, by, 144, 44, {
          enabled: !sel.acted,
          primary: ctl.mode.kind === 'weapon' && ctl.mode.index === i && !sel.acted,
          sub: w.kind === 'deploy' ? 'range 2' : `rng ${w.minRange}-${w.range}`,
        });
      });
      const w = ctl.weapon;
      if (w) txt(c, w.blurb, x, by + 62, 12, PAL.paper);
      else if (sel.acted) txt(c, `${def.name} has acted this turn.`, x, by + 62, 12, PAL.paper);
      else txt(c, def.blurb, x, by + 62, 12, PAL.paper);
    } else if (!o.enemyPhase) {
      txt(c, 'Select a squad member: click, or press Tab.', x, by + 14, 12, PAL.kraft);
    }

    // actions
    const ay = H - 118;
    const canAct = s.phase === 'player' && !o.enemyPhase;
    this.button(c, 'undo', 'UNDO', x, ay, 100, 40, { enabled: canAct && session.history.canUndo, sub: 'Z' });
    this.button(c, 'redo', 'REDO', x + 108, ay, 100, 40, { enabled: canAct && session.history.canRedo, sub: 'Y' });
    this.button(c, 'end', o.enemyPhase ? 'ENEMY TURN...' : 'END TURN', x + 224, ay, PANEL_W - 224 - 20, 40, { enabled: canAct, primary: true, sub: 'Space' });

    // log + hints
    let ly = H - 62;
    for (const line of o.log.slice(-3)) {
      txt(c, line, x, ly, 12, PAL.paper);
      ly += 17;
    }
    txt(c, `R restart · F1 AI inspector · M sound ${o.muted ? 'off' : 'on'} · Esc deselect`, x, H - 10, 11, PAL.kraft);
    if (ctl.message) txt(c, ctl.message, x, ay - 14, 12, PAL.mustard);
  }

  private unitCard(c: CanvasRenderingContext2D, u: Unit, x: number, y: number, selected: boolean): void {
    const h = u.kind === 'turret' ? 44 : 66;
    card(c, x, y, PANEL_W - 20, h, selected ? '#fff6dc' : PAL.paper);
    c.fillStyle = UNIT_COLOR[u.kind];
    c.strokeStyle = PAL.ink;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x + 32, y + h / 2, u.kind === 'turret' ? 14 : 20, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    head(c, UNITS[u.kind].letter, x + 32, y + h / 2 + 1, u.kind === 'turret' ? 14 : 20, PAL.paper, 'center');
    head(c, UNITS[u.kind].name.toUpperCase(), x + 66, y + 18, 17);
    for (let i = 0; i < u.maxHp; i++) {
      c.fillStyle = i < u.hp ? PAL.brick : 'rgba(35,32,27,0.15)';
      c.fillRect(x + 66 + i * 20, y + 31, 16, 10);
      c.strokeStyle = PAL.ink;
      c.lineWidth = 2;
      c.strokeRect(x + 66 + i * 20, y + 31, 16, 10);
    }
    if (u.kind !== 'turret') {
      const state = u.acted ? 'DONE' : u.moved ? 'MOVED' : 'READY';
      txt(c, state, x + PANEL_W - 40, y + 18, 13, u.acted ? PAL.inkSoft : PAL.good, 'right');
      if (u.suppressed > 0) txt(c, 'PINNED -2 MOVE', x + PANEL_W - 40, y + 38, 12, PAL.plum, 'right');
      txt(c, UNITS[u.kind].blurb, x + 66, y + 54, 11, PAL.inkSoft);
    }
  }

  private drawInspector(c: CanvasRenderingContext2D, session: Session, ctl: Controller): void {
    const e = ctl.inspected();
    const w = PANEL_W - 20;
    const h = H - 132 - 128;
    const x = PANEL_X;
    const y = 132;
    c.save();
    c.globalAlpha = 1;
    card(c, x, y, w, h, '#efe5c8');
    head(c, 'AI BRAIN', x + 14, y + 22, 18);
    txt(c, 'F1 to close', x + w - 14, y + 22, 11, PAL.inkSoft, 'right');
    if (!e || !e.plan) {
      txt(c, 'Hover or click an enemy to inspect its utility scores.', x + 14, y + 60, 13, PAL.inkSoft);
      txt(c, `Grid ${session.state.grid.w}x${session.state.grid.h} · version ${session.state.version} · undo stack ${session.history.size}`, x + 14, y + 84, 12, PAL.inkSoft);
      c.restore();
      return;
    }
    const def = UNITS[e.kind];
    txt(c, `${def.name} #${e.id} at ${String.fromCharCode(65 + e.x)}${e.y + 1}   hp ${e.hp}/${e.maxHp}   ${e.suppressed ? 'PINNED' : ''}`, x + 14, y + 44, 13);
    const ch = e.plan.chosen;
    txt(c, ch ? `Chosen: ${this.describe(ch)}  total ${ch.score.toFixed(2)}` : 'Chosen: none', x + 14, y + 64, 13, PAL.brick);
    // header
    const cols = [14, 150];
    txt(c, 'Option', x + cols[0], y + 90, 11, PAL.inkSoft);
    txt(c, 'Total', x + cols[1], y + 90, 11, PAL.inkSoft);
    FACTORS.forEach((f, i) => txt(c, ['Flank', 'Dmg', 'Kill', 'Syn', 'Expo', 'FF', 'Adv'][i] ?? f.label, x + 212 + i * 38, y + 90, 10, PAL.inkSoft, 'center'));
    e.plan.top.slice(0, 8).forEach((cand, r) => {
      const ry = y + 116 + r * 41;
      if (r === 0) {
        c.fillStyle = 'rgba(194,65,45,0.14)';
        c.fillRect(x + 6, ry - 17, w - 12, 36);
      }
      txt(c, this.describe(cand), x + cols[0], ry, 12, r === 0 ? PAL.ink : PAL.inkSoft);
      txt(c, cand.score.toFixed(2), x + cols[1], ry, 13, PAL.ink, 'left', MONO);
      FACTORS.forEach((f, i) => {
        const v = cand.weighted[f.key];
        const raw = cand.factors[f.key];
        txt(c, v === 0 ? '·' : (v > 0 ? '+' : '') + v.toFixed(2), x + 212 + i * 38, ry - 4, 12, v > 0 ? PAL.good : v < 0 ? PAL.brick : PAL.inkSoft, 'center', MONO);
        if (raw !== 0) txt(c, `(${raw.toFixed(1)})`, x + 212 + i * 38, ry + 9, 8, PAL.inkSoft, 'center', MONO);
      });
    });
    txt(c, 'Board heatmap = best score from each tile. Outline = chosen tile.', x + 14, y + h - 12, 11, PAL.inkSoft);
    c.restore();
  }

  private describe(cand: Candidate): string {
    const t = `${String.fromCharCode(65 + cand.mx)}${cand.my + 1}`;
    if (!cand.weapon) return `Move to ${t}`;
    return `${t}: ${WEAPONS[cand.weapon].name.split(' ')[0]} > ${String.fromCharCode(65 + cand.tx)}${cand.ty + 1}`;
  }

  // ---- screens ----------------------------------------------------------------------------

  drawTitle(c: CanvasRenderingContext2D): void {
    this.buttons = [];
    c.fillStyle = 'rgba(28,33,25,0.93)';
    c.fillRect(0, 0, W, H);
    // Measured, not hard-coded centres: at 92px the two words are wider than the old 360px gap and overlapped.
    c.font = `900 92px ${HEAD}`;
    const first = c.measureText('BREACH ').width;
    const x0 = W / 2 - (first + c.measureText('PROTOCOL').width) / 2;
    head(c, 'BREACH', x0, 120, 92, PAL.paper);
    head(c, 'PROTOCOL', x0 + first, 120, 92, PAL.mustard);
    txt(c, 'A three-room tactical squad puzzle. Read the telegraphs, then break them.', W / 2, 178, 17, PAL.kraft, 'center');
    const x = 200;
    let y = 236;
    const rules: [string, string][] = [
      ['Turn', 'Each unit gets one move, then one action. Moving first is optional.'],
      ['Telegraphs', 'Red arrows show what every enemy will do next. They attack at the START of the enemy phase.'],
      ['Break them', 'Kill, shove or pin an enemy and its attack is disrupted. Step out of the target tile and it whiffs.'],
      ['Cover', 'Half cover (sandbags) cuts a shot by 1. The Rail Rifle ignores it. Full crates and walls block sight.'],
      ['Push', 'Shoving a unit into a wall, cover or another unit deals +1. Barrels explode (3 damage, 3x3, chains).'],
      ['Hazard', 'Ending a move or a push on striped floor costs 1 HP.'],
      ['Preview', 'Hover a target for the exact result: damage, cover, push destination, KILL badges.'],
      ['Undo', 'Z undoes any action this turn, exactly. Ending the turn commits.'],
    ];
    for (const [k, v] of rules) {
      head(c, k.toUpperCase(), x, y, 14, PAL.mustard);
      txt(c, v, x + 150, y, 14, PAL.paper);
      y += 32;
    }
    txt(c, 'Click a unit, click a tile. 1 / 2 pick weapons. Space ends the turn. R restarts the campaign.', W / 2, 520, 14, PAL.kraft, 'center');
    this.button(c, 'start', 'START OPERATION', W / 2 - 170, 566, 340, 60, { primary: true, sub: 'click or press Enter' });
  }

  private drawCleared(c: CanvasRenderingContext2D, session: Session): void {
    c.fillStyle = 'rgba(28,33,25,0.7)';
    c.fillRect(0, 0, W, H);
    const w = 560;
    const h = 330;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    card(c, x, y, w, h);
    head(c, 'ROOM CLEARED', W / 2, y + 52, 44, PAL.ink, 'center');
    txt(c, ROOMS[session.state.room].name.toUpperCase(), W / 2, y + 90, 15, PAL.inkSoft, 'center');
    const lines = [
      `Turns taken: ${session.stats.turns}`,
      `Hostiles down so far: ${session.stats.kills + session.state.units.filter((u) => u.team === 'enemy').length}`,
      `Squad: ${livingUnits(session.state, 'player').filter((u) => u.kind !== 'turret').map((u) => `${UNITS[u.kind].letter} ${u.hp}/${u.maxHp}`).join('   ')}`,
      'Survivors patch up +1 HP before the next room.',
    ];
    lines.forEach((l, i) => txt(c, l, W / 2, y + 140 + i * 30, 16, PAL.ink, 'center'));
    const last = session.state.room + 1 >= ROOMS.length;
    this.buttons = [];
    this.button(c, 'next', last ? 'FINISH OPERATION' : 'NEXT ROOM', W / 2 - 150, y + h - 80, 220, 54, { primary: true, sub: 'Enter' });
    this.button(c, 'undo', 'UNDO', W / 2 + 84, y + h - 80, 96, 54, { enabled: session.history.canUndo, sub: 'Z' });
  }

  private drawEnd(c: CanvasRenderingContext2D, session: Session, won: boolean): void {
    c.fillStyle = 'rgba(28,33,25,0.82)';
    c.fillRect(0, 0, W, H);
    const w = 560;
    const h = 400;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    card(c, x, y, w, h);
    head(c, won ? 'BREACH COMPLETE' : 'SQUAD LOST', W / 2, y + 56, 44, won ? PAL.good : PAL.brick, 'center');
    const st = session.stats;
    const rows: [string, string][] = [
      ['Rooms cleared', won ? `${ROOMS.length}/${ROOMS.length}` : `${session.state.room}/${ROOMS.length}`],
      ['Turns', String(st.turns)],
      ['Hostiles defeated', String(st.kills)],
      ['Squad members lost', String(st.squadLost)],
      ['Undos used', String(st.undos)],
    ];
    rows.forEach(([k, v], i) => {
      txt(c, k, W / 2 - 20, y + 120 + i * 38, 17, PAL.inkSoft, 'right');
      head(c, v, W / 2 + 20, y + 120 + i * 38, 22, PAL.ink, 'left');
    });
    this.buttons = [];
    this.button(c, 'restart', 'RESTART CAMPAIGN', W / 2 - 170, y + h - 84, 340, 56, { primary: true, sub: 'R' });
  }
}
