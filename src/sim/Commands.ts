import { WEAPONS, type WeaponId } from '../data/defs';
import { applyHazard, resolveAttack, type Effect } from './Combat';
import { restoreSnapshot, takeSnapshot, type GameState, type Snapshot, type Unit } from './State';

/** Every player action is a command: `execute` mutates the state, `undo` restores it exactly. */
export interface ICommand {
  readonly label: string;
  execute(state: GameState, fx: Effect[]): void;
  undo(state: GameState): void;
}

function unit(state: GameState, id: number): Unit {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown unit ${id}`);
  return u;
}

/**
 * Commands keep a memento (a deep copy of terrain + units) taken just before they run.
 * Undo restores a fresh copy of it, so the stored snapshot is never aliased by live state
 * and the same command can be re-executed for redo.
 */
abstract class SnapshotCommand implements ICommand {
  abstract readonly label: string;
  private before: Snapshot | null = null;

  execute(state: GameState, fx: Effect[]): void {
    this.before = takeSnapshot(state);
    this.run(state, fx);
    state.version++;
  }

  undo(state: GameState): void {
    if (this.before) restoreSnapshot(state, this.before);
  }

  protected abstract run(state: GameState, fx: Effect[]): void;
}

export class MoveCommand extends SnapshotCommand {
  readonly label: string;
  constructor(
    private readonly unitId: number,
    private readonly toX: number,
    private readonly toY: number,
    private readonly steps: number,
  ) {
    super();
    this.label = `Move to ${toX},${toY}`;
  }

  protected run(state: GameState, fx: Effect[]): void {
    const u = unit(state, this.unitId);
    fx.push({ t: 'move', unitId: u.id, fromX: u.x, fromY: u.y, toX: this.toX, toY: this.toY, steps: this.steps });
    u.x = this.toX;
    u.y = this.toY;
    u.moved = true;
    applyHazard(state, u, fx);
  }
}

export class AttackCommand extends SnapshotCommand {
  readonly label: string;
  constructor(
    private readonly unitId: number,
    private readonly weapon: WeaponId,
    private readonly tx: number,
    private readonly ty: number,
  ) {
    super();
    this.label = `${WEAPONS[weapon].name} at ${tx},${ty}`;
  }

  protected run(state: GameState, fx: Effect[]): void {
    const u = unit(state, this.unitId);
    resolveAttack(state, u, WEAPONS[this.weapon], this.tx, this.ty, fx);
    u.acted = true;
    u.moved = true;
  }
}

/** Undo / redo stacks scoped to the active player turn. */
export class CommandHistory {
  private undoStack: ICommand[] = [];
  private redoStack: ICommand[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get size(): number {
    return this.undoStack.length;
  }
  get labels(): string[] {
    return this.undoStack.map((c) => c.label);
  }

  run(cmd: ICommand, state: GameState, fx: Effect[]): void {
    cmd.execute(state, fx);
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
  }

  undo(state: GameState): ICommand | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo(state);
    this.redoStack.push(cmd);
    return cmd;
  }

  redo(state: GameState, fx: Effect[]): ICommand | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.execute(state, fx);
    this.undoStack.push(cmd);
    return cmd;
  }

  /** Ending the turn commits everything: the stacks are dropped. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
