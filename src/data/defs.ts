/**
 * Data-driven definitions. Stats, weapons, AI weights and room layouts live here;
 * the rules that execute them live in src/sim and src/grid.
 */

export type TileType = 'floor' | 'wall' | 'half' | 'full' | 'barrel' | 'hazard';
export type Team = 'player' | 'enemy';
export type UnitKind = 'vanguard' | 'recon' | 'engineer' | 'turret' | 'grunt' | 'suppressor' | 'breacher';
export type WeaponId = 'shotgun' | 'rail' | 'concussive' | 'deploy' | 'rifle' | 'suppress' | 'bash' | 'turretGun';

export const GRID_W = 10;
export const GRID_H = 10;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 'attack' needs a target tile with LOS; 'deploy' needs an empty floor tile. */
  kind: 'attack' | 'deploy';
  minRange: number;
  range: number;
  /** Damage by distance (index 0 = distance 1). The last entry repeats. */
  damage: readonly number[];
  /** Tiles the target is pushed along the shot vector (0 = none). */
  push: number;
  /** Ignore the 1-damage reduction from half cover. */
  ignoresCover: boolean;
  /** Extra units hit along the same line behind the first, at (damage - 1). */
  pierce: number;
  suppress: boolean;
  blurb: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  shotgun: { id: 'shotgun', name: 'Breaching Shotgun', kind: 'attack', minRange: 1, range: 3, damage: [3, 3, 2], push: 1, ignoresCover: false, pierce: 0, suppress: false, blurb: 'Close blast. Knocks the target back 1 tile; slamming into something deals +1.' },
  rail: { id: 'rail', name: 'Rail Rifle', kind: 'attack', minRange: 2, range: 8, damage: [3], push: 0, ignoresCover: true, pierce: 1, suppress: false, blurb: 'Ignores half cover and pierces to hit a second unit in line.' },
  concussive: { id: 'concussive', name: 'Concussive Shot', kind: 'attack', minRange: 1, range: 5, damage: [1], push: 2, ignoresCover: false, pierce: 0, suppress: false, blurb: 'Shoves the target 2 tiles. Barrels, hazards and allies are the real damage.' },
  deploy: { id: 'deploy', name: 'Deploy Turret', kind: 'deploy', minRange: 1, range: 2, damage: [0], push: 0, ignoresCover: false, pierce: 0, suppress: false, blurb: 'Place an auto-turret on an empty tile. Only one at a time.' },
  rifle: { id: 'rifle', name: 'Carbine', kind: 'attack', minRange: 1, range: 6, damage: [2], push: 0, ignoresCover: false, pierce: 0, suppress: false, blurb: '' },
  suppress: { id: 'suppress', name: 'Suppressing Fire', kind: 'attack', minRange: 1, range: 7, damage: [1], push: 0, ignoresCover: false, pierce: 0, suppress: true, blurb: '' },
  bash: { id: 'bash', name: 'Breach Charge', kind: 'attack', minRange: 1, range: 2, damage: [3], push: 1, ignoresCover: true, pierce: 0, suppress: false, blurb: '' },
  turretGun: { id: 'turretGun', name: 'Sentry Gun', kind: 'attack', minRange: 1, range: 5, damage: [1], push: 0, ignoresCover: false, pierce: 0, suppress: false, blurb: '' },
};

export interface UnitDef {
  kind: UnitKind;
  team: Team;
  name: string;
  letter: string;
  hp: number;
  move: number;
  weapons: readonly WeaponId[];
  blurb: string;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  vanguard: { kind: 'vanguard', team: 'player', name: 'Vanguard', letter: 'V', hp: 5, move: 4, weapons: ['shotgun'], blurb: 'Tank. Close-range knockback.' },
  recon: { kind: 'recon', team: 'player', name: 'Recon', letter: 'R', hp: 3, move: 5, weapons: ['rail'], blurb: 'Long-range piercing shots.' },
  engineer: { kind: 'engineer', team: 'player', name: 'Engineer', letter: 'E', hp: 4, move: 4, weapons: ['concussive', 'deploy'], blurb: 'Displacement and sentry turrets.' },
  turret: { kind: 'turret', team: 'player', name: 'Sentry', letter: 'T', hp: 2, move: 0, weapons: ['turretGun'], blurb: 'Fires automatically when you end the turn.' },
  grunt: { kind: 'grunt', team: 'enemy', name: 'Grunt', letter: 'G', hp: 4, move: 4, weapons: ['rifle'], blurb: 'Flanks and shoots.' },
  suppressor: { kind: 'suppressor', team: 'enemy', name: 'Suppressor', letter: 'S', hp: 3, move: 3, weapons: ['suppress'], blurb: 'Long range; pins a target (-2 move).' },
  breacher: { kind: 'breacher', team: 'enemy', name: 'Breacher', letter: 'B', hp: 6, move: 4, weapons: ['bash'], blurb: 'Charges in and throws units around.' },
};

/** Utility-AI weights per archetype. Every factor is normalised to roughly 0..1 before weighting. */
export interface AIWeights {
  damage: number;
  kill: number;
  flank: number;
  synergy: number;
  exposure: number;
  friendlyFire: number;
  advance: number;
}

export const AI_WEIGHTS: Record<'grunt' | 'suppressor' | 'breacher', AIWeights> = {
  grunt: { damage: 1.0, kill: 1.6, flank: 0.9, synergy: 0.6, exposure: 0.7, friendlyFire: 1.8, advance: 0.25 },
  suppressor: { damage: 0.7, kill: 1.4, flank: 0.4, synergy: 0.8, exposure: 1.3, friendlyFire: 1.8, advance: 0.15 },
  breacher: { damage: 1.0, kill: 1.5, flank: 0.3, synergy: 1.4, exposure: 0.3, friendlyFire: 1.8, advance: 0.4 },
};

/**
 * Legend: . floor  # wall  h half cover  F full cover  B explosive barrel  ~ hazard
 * Units: V R E (squad spawn)   g s b (grunt / suppressor / breacher)
 */
export interface RoomDef {
  name: string;
  tagline: string;
  layout: readonly string[];
}

export const ROOMS: readonly RoomDef[] = [
  {
    name: 'Loading Dock',
    tagline: 'Three hostiles. Learn the cover.',
    layout: [
      '...g..s...',
      '..h....h..',
      '....B..g..',
      '..........',
      '.##....##.',
      '..........',
      '...F..F..~',
      '..........',
      '..V.R.E...',
      '..........',
    ],
  },
  {
    name: 'Server Hall',
    tagline: 'A Breacher joins. Mind the barrels.',
    layout: [
      '..s....b..',
      '..........',
      '.FF....hh.',
      '....g.....',
      '..B....B..',
      '~~......g.',
      '..hh..hh..',
      '..........',
      '...V.R.E..',
      '..........',
    ],
  },
  {
    name: 'Reactor Core',
    tagline: 'Five hostiles. The floor is hot.',
    layout: [
      '.b...s.b..',
      '..........',
      '..FF..FF..',
      '...B..B...',
      '.g......g.',
      '..~~~~~~..',
      '..h....h..',
      '..........',
      '..V.R.E...',
      '..........',
    ],
  },
];
