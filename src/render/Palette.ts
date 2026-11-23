/** Tabletop wargame palette: kraft board, olive felt, stencil ink and a few spot colours. */
export const PAL = {
  felt: '#3b4636',
  feltDark: '#2f3a2c',
  kraft: '#d4c298',
  kraftAlt: '#cdb98d',
  kraftDark: '#a8946a',
  paper: '#f1e8d0',
  ink: '#23201b',
  inkSoft: 'rgba(35,32,27,0.55)',
  shadow: 'rgba(20,18,14,0.32)',
  brick: '#c2412d',
  orange: '#e8791f',
  mustard: '#d9a21b',
  teal: '#2f8f8a',
  cobalt: '#3a63c8',
  plum: '#8a3a6e',
  olive: '#5c6b3a',
  crate: '#9a6b3f',
  wall: '#3a3834',
  good: '#2d7a3e',
};

export const UNIT_COLOR: Record<string, string> = {
  vanguard: PAL.mustard,
  recon: PAL.teal,
  engineer: PAL.cobalt,
  turret: '#8a8466',
  grunt: PAL.brick,
  suppressor: PAL.plum,
  breacher: PAL.orange,
};

export const HEAD = '"Arial Black", Impact, "Helvetica Neue", sans-serif';
export const BODY = '"Trebuchet MS", "Segoe UI", Verdana, sans-serif';
export const MONO = '"Consolas", "Courier New", monospace';
