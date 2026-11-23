# Breach Protocol

A compact turn-based tactical room-clearing game in the spirit of *Into the Breach* and *XCOM*. Built with **TypeScript, Vite and HTML5 Canvas**, with zero external assets: art is drawn procedurally and sound is synthesized with WebAudio.

A three-person squad clears three rooms on a 10x10 grid. Every enemy **telegraphs** what it will do next turn. Your job is to read those red arrows and break them: kill, shove, pin, or just step out of the way.

## Run it

```bash
npm install
npm run dev        # http://localhost:5175 from the workspace launcher
npm run build      # tsc --noEmit + production bundle
npm run typecheck
```

## How to play

- Each unit gets **one move, then one action** per turn. Moving first is optional; acting ends that unit's turn.
- **Click** a squad member (or press `Tab`), click a highlighted tile to move, then pick a weapon (`1` / `2`) and click a target. Hover a target to see the **exact outcome** before committing.
- `Z` undoes any action this turn, `Y` redoes. `Space` ends the turn (and commits: the undo history is cleared).
- `R` restarts the campaign, `F1` opens the AI inspector, `M` mutes, `Esc` or right-click deselects.

### Squad

| Unit | HP | Move | Weapon |
| --- | --- | --- | --- |
| **Vanguard** | 5 | 4 | Breaching Shotgun, range 1-3, damage 3/3/2, knockback 1 |
| **Recon** | 3 | 5 | Rail Rifle, range 2-8, damage 3, ignores half cover, pierces to a second unit for 2 |
| **Engineer** | 4 | 4 | Concussive Shot (1 damage, shoves 2 tiles) or Deploy Turret (one sentry at a time) |

Sentries fire automatically at the nearest visible enemy when you end the turn.

### Enemies

| Unit | HP | Move | Weapon |
| --- | --- | --- | --- |
| **Grunt** | 4 | 4 | Carbine, range 6, 2 damage |
| **Suppressor** | 3 | 3 | Range 7, 1 damage, **pins** the target (-2 move next turn) |
| **Breacher** | 6 | 4 | Breach charge, range 2, 3 damage, knockback 1 |

### Terrain

| Tile | Effect |
| --- | --- |
| Wall / full cover | Blocks movement and line of sight |
| Half cover (sandbags) | Blocks movement; a target behind it takes 1 less damage (the Rail Rifle ignores this) |
| Explosive barrel | Any hit or collision detonates it: 3 damage in a 3x3 area, destroys cover, **chains** into neighbouring barrels |
| Hazard | Ending a move or a push there costs 1 HP; entering costs 2 movement |

**Collisions.** Knocking a unit into a wall, cover, the map edge or another unit deals +1 to it (and to the unit it hits). Knocking it into a barrel sets the barrel off.

## Architecture

```
src/
  core/    EventBus.ts                typed pub/sub
  data/    defs.ts                    units, weapons, AI weights, room layouts (data only)
  grid/    Grid.ts                    tiles, Bresenham LOS, cover query, push vectors
           Pathing.ts                 Dijkstra movement range + path reconstruction
  sim/     State.ts                   game state, room builder, snapshots
           Combat.ts                  the single attack resolver, previews, explosions, pushes
           Commands.ts                ICommand, Move/Attack commands, CommandHistory
           Turn.ts                    end-of-turn, EnemyDirector, win/lose
           Session.ts                 owns the state; the only thing the UI calls
           ai/Planner.ts              Utility AI
  render/  Renderer.ts, Fx.ts, Palette.ts, Layout.ts
  audio/   SoundEngine.ts
  ui/      Controller.ts (selection / targeting), Panels.ts (side panel, menus, AI inspector)
  Game.ts  composition root, input, enemy-phase pacing
```

`src/sim`, `src/grid` and `src/data` never touch the DOM, canvas or audio. The simulation only emits typed events (`EFFECT`, `UNDO`, `PLAYER_PHASE`, ...). Particles, floating tags, screen shake and sound all react to those.

### Data-driven design

Stats, weapons (range, damage by distance, push distance, pierce, suppress), AI weights and the three room layouts are plain tables in `src/data/defs.ts`. Rooms are 10-line strings, so adding a room is adding ten characters per row. The rules in `src/sim` read those tables and contain no stat constants of their own.

### One resolver for everything

`resolveAttack(state, attacker, weapon, x, y, fx)` is the only function that applies a weapon. It is used by:

- the player's `AttackCommand`,
- enemies executing their telegraphed attacks,
- sentry fire,
- **hover previews**, which run the same function on a cloned state and read the resulting effects.

Because there is a single code path, a preview can't disagree with the real result. The preview badges (damage per unit, `COVER -1`, `SLAM +1`, `KILL`, push arrows, the 3x3 blast area) are derived from the effect list, not recomputed.

### Command pattern with exact undo / redo

Every player action is an `ICommand { execute(state, fx); undo(state) }`: `MoveCommand` and `AttackCommand` (deploy is an attack-kind command). `CommandHistory` keeps an undo and a redo stack scoped to the current player turn.

Commands take a **memento** (a deep copy of the terrain and all units) just before running. `undo` restores a fresh copy of it, so the stored snapshot is never aliased by live state, and `redo` simply re-executes the command (combat is fully deterministic, so it replays identically). Ending the turn clears both stacks, which is what commits the turn. Undoing the shot that cleared a room also works.

One consequence worth knowing: restoring a snapshot replaces the unit objects, so the UI always refers to units by **id**, never by reference.

### Grid, pathing and line of sight

- **Movement:** Dijkstra over four-way moves. Walls, cover, barrels and any living unit block; hazard costs 2 to enter. Suppression reduces the budget by 2. Paths are reconstructed from the predecessor array and previewed with a step counter.
- **Line of sight:** a Bresenham line between tile centres; any wall or full cover strictly between the endpoints blocks it. Half cover and barrels do not.
- **Cover:** a target is covered if a half-cover tile touches it on the side facing the shooter (orthogonal or diagonal neighbour).
- **Knockback:** the push vector is the dominant axis of the shot (or a diagonal when the offsets tie), so it is always predictable and previewable.

### Utility AI with telegraphed intent

`planFor` (`src/sim/ai/Planner.ts`) enumerates every option for an enemy: each reachable tile (a plain "reposition" option, plus an attack on each valid target from that tile). Each attack option is evaluated by running the real resolver on a clone, then scored with transparent weighted factors:

| Factor | Meaning |
| --- | --- |
| **Flank** | Share of the shot's hits that land on a target without cover |
| **Damage** | Damage dealt to the squad (sentries count half), plus a bonus for pinning |
| **Kill** | Squad members killed |
| **Synergy** | Explosion and collision damage dealt to the squad |
| **Exposure** (penalty) | How many squad weapons can see the destination tile, plus a hazard penalty |
| **Friendly fire** (penalty) | Damage to other enemies, including from its own blast or push |
| **Advance** | Closeness to the squad, so idle enemies still close in |

Weights live per archetype in `AI_WEIGHTS`: Grunts value flanking, Suppressors avoid exposure, Breachers love collisions and explosions. The planner is fully deterministic (ties break on movement cost, then tile order), and the whole campaign is reproducible.

**Telegraphing.** Planning happens at the end of each enemy's action: it moves, then locks an `Intent { weapon, targetTile }`. That intent is drawn on the board as a red arrow, a highlighted target tile, a per-unit damage badge and a push arrow, all derived from a live preview. The attack fires at the *start of that enemy's next turn* from wherever the enemy is standing then:

- If the enemy was shoved out of range or line of sight, or died, the attack is **disrupted**.
- If the target stepped away, it hits an empty tile and whiffs.
- If another unit is standing in the target tile, it takes the shot, which can be one of the enemy's own.

At room start every enemy plans once, so the very first turn already shows telegraphs.

### F1 AI inspector

Press `F1`, then hover or click an enemy. The side panel shows its chosen plan and the top eight candidates, each with the weighted contribution of every factor and the raw value in brackets. The board gets a **heatmap** of the best score reachable from each tile, with the chosen destination outlined.

## Presentation

The look is a tabletop wargame: olive felt, a kraft-paper board, stencil letters, hard offset shadows and a limited spot palette. Squad members are round tokens and enemies are square ones, so you can tell them apart without colour.

- Smooth movement interpolation, including shoves.
- Particle bursts for shots, hits, kills, cover destruction and barrel explosions; floating damage and status tags; white hit-flash; death fade.
- Screen shake scaled by event (small for shots, large for wall slams and explosions).
- Procedural audio: footsteps (one per tile), shotgun boom, rail crack, concussive thump, explosion rumble, slam, cover crunch, deploy clunk, undo / redo sweeps, turn chimes, room-clear and campaign fanfares. `M` mutes.

## Verification

- `tsc --noEmit` and `vite build` pass.
- Rules checked headlessly against the real simulation (not just by eye): a shotgun wall slam (+1), the cover reduction and the Rail Rifle ignoring it, barrel chains of three, pierce (3 then 2), a concussive shove into another unit (both take 1), hazard landing, suppression, turret deployment limits, and **undo / redo restoring state exactly** (compared field by field).
- A scripted bot plays the full campaign twice from a fresh start with identical results, so the sim and AI are deterministic. Restarting repeatedly leaves the event-listener count unchanged.
- Not verified: I have not played it by hand with a real mouse. The bot is aggressive and loses squad members, so it says little about how hard the game feels to a person. There is no gamepad or touch support and no save system.
