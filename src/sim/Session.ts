import type { EventBus } from '../core/EventBus';
import { ROOMS, UNITS, type UnitKind, type WeaponId } from '../data/defs';
import type { Effect } from './Combat';
import { AttackCommand, CommandHistory, MoveCommand, type ICommand } from './Commands';
import { buildRoom, livingUnits, type GameState, type Phase } from './State';
import { checkOutcome, EnemyDirector, endPlayerTurn, planAllEnemies } from './Turn';

export type SimEvents = {
  EFFECT: Effect;
  ROOM_START: { room: number; name: string };
  PLAYER_PHASE: { turn: number };
  ENEMY_PHASE: Record<string, never>;
  UNDO: { label: string };
  REDO: { label: string };
  TURN_END: Record<string, never>;
  ROOM_CLEARED: { room: number };
  CAMPAIGN_WON: Record<string, never>;
  CAMPAIGN_LOST: Record<string, never>;
};

export interface CampaignStats {
  turns: number;
  kills: number;
  undos: number;
  squadLost: number;
}

/**
 * Owns the live game state and everything that may change it. Pure simulation: it
 * emits typed events and never touches the DOM, Canvas or WebAudio.
 */
export class Session {
  state: GameState;
  readonly history = new CommandHistory();
  readonly director = new EnemyDirector();
  stats: CampaignStats = { turns: 0, kills: 0, undos: 0, squadLost: 0 };
  private carry = new Map<UnitKind, number>();

  constructor(readonly bus: EventBus<SimEvents>) {
    this.state = buildRoom(0);
  }

  /** Full campaign restart (the `R` key). */
  newCampaign(): void {
    this.stats = { turns: 0, kills: 0, undos: 0, squadLost: 0 };
    this.carry = new Map();
    this.loadRoom(0);
  }

  loadRoom(room: number): void {
    this.history.clear();
    this.state = buildRoom(room, this.carry);
    const fx: Effect[] = [];
    planAllEnemies(this.state, fx);
    this.state.version++;
    this.bus.emit('ROOM_START', { room, name: ROOMS[room].name });
    this.bus.emit('PLAYER_PHASE', { turn: this.state.turn });
  }

  /** Re-read each time: control flow narrowing cannot see phase changes made inside helpers. */
  get phase(): Phase {
    return this.state.phase;
  }

  get roomCount(): number {
    return ROOMS.length;
  }

  /** After a cleared room: bank stats, carry the squad forward and load the next room. */
  advance(): void {
    if (this.state.phase !== 'cleared') return;
    this.bankRoom();
    if (this.state.room + 1 >= ROOMS.length) {
      this.state.phase = 'won';
      this.bus.emit('CAMPAIGN_WON', {});
      return;
    }
    this.loadRoom(this.state.room + 1);
  }

  run(cmd: ICommand): void {
    if (this.state.phase !== 'player') return;
    const fx: Effect[] = [];
    this.history.run(cmd, this.state, fx);
    this.publish(fx);
    this.afterChange();
  }

  move(unitId: number, x: number, y: number, steps: number): void {
    this.run(new MoveCommand(unitId, x, y, steps));
  }

  attack(unitId: number, weapon: WeaponId, x: number, y: number): void {
    this.run(new AttackCommand(unitId, weapon, x, y));
  }

  undo(): boolean {
    // the final shot of a room can still be taken back until the next room is loaded
    if (this.phase !== 'player' && this.phase !== 'cleared') return false;
    const c = this.history.undo(this.state);
    if (!c) return false;
    if (this.phase === 'cleared') this.state.phase = 'player';
    this.stats.undos++;
    this.bus.emit('UNDO', { label: c.label });
    return true;
  }

  redo(): boolean {
    if (this.state.phase !== 'player') return false;
    const fx: Effect[] = [];
    const c = this.history.redo(this.state, fx);
    if (!c) return false;
    this.publish(fx);
    this.bus.emit('REDO', { label: c.label });
    this.afterChange();
    return true;
  }

  /** Commit the turn (clears undo history), fire sentries and start the enemy phase. */
  endTurn(): void {
    if (this.state.phase !== 'player') return;
    this.history.clear();
    const fx: Effect[] = [];
    endPlayerTurn(this.state, fx);
    this.stats.turns++;
    this.publish(fx);
    this.bus.emit('TURN_END', {});
    if (this.phase === 'enemy') {
      this.director.begin(this.state);
      this.bus.emit('ENEMY_PHASE', {});
    } else this.afterChange();
  }

  /** Advance the enemy phase by one actor. Returns true while more actors remain. */
  stepEnemy(): boolean {
    if (this.state.phase !== 'enemy') return false;
    const fx: Effect[] = [];
    const more = this.director.step(this.state, fx);
    this.publish(fx);
    if (!more) {
      this.director.finish(this.state);
      if (this.phase === 'player') this.bus.emit('PLAYER_PHASE', { turn: this.state.turn });
      this.afterChange();
      return false;
    }
    return true;
  }

  private publish(fx: Effect[]): void {
    for (const e of fx) this.bus.emit('EFFECT', e);
  }

  private afterChange(): void {
    checkOutcome(this.state);
    if (this.state.phase === 'lost') {
      this.bankRoom();
      this.bus.emit('CAMPAIGN_LOST', {});
    } else if (this.state.phase === 'cleared') {
      this.bus.emit('ROOM_CLEARED', { room: this.state.room });
    }
  }

  private bankRoom(): void {
    const s = this.state;
    const enemiesInRoom = s.units.filter((u) => u.team === 'enemy').length;
    this.stats.kills += enemiesInRoom - livingUnits(s, 'enemy').length;
    this.stats.squadLost += s.units.filter((u) => u.team === 'player' && u.kind !== 'turret' && !u.alive).length;
    this.carry = new Map();
    for (const u of livingUnits(s, 'player')) {
      if (u.kind === 'turret') continue;
      // squad patches up a little between rooms
      this.carry.set(u.kind, Math.min(UNITS[u.kind].hp, u.hp + 1));
    }
  }
}
