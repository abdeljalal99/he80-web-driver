// The HE80's built-in Fn functions (what Fn + key does while its Fn-layer entry is all zero). The keyboard doesn't
// report these (0x1C gets no reply), so they come from the official hubs: old `getEpomakerHE80`, new `ug` (same list).

export interface BuiltIn { short: string; long: string }

export const FN_BUILT_IN: Record<number, BuiltIn> = {
  1: { short: 'My PC', long: 'My Computer' },
  2: { short: 'Files', long: 'Open Explorer' },
  3: { short: 'Calc', long: 'Calculator' },
  4: { short: 'Mail', long: 'Email' },
  5: { short: 'Media', long: 'Media player' },
  6: { short: 'Stop', long: 'Stop playback' },
  7: { short: 'Prev', long: 'Previous track' },
  8: { short: 'Play', long: 'Play / Pause' },
  9: { short: 'Next', long: 'Next track' },
  10: { short: 'Mute', long: 'Mute' },
  11: { short: 'Vol −', long: 'Volume down' },
  12: { short: 'Vol +', long: 'Volume up' },
  106: { short: 'Ins', long: 'Insert' },
  92: { short: 'Lights off', long: 'Lights off' },
  104: { short: 'End', long: 'End' },
  40: { short: 'PrtSc', long: 'Print Screen' },
  41: { short: 'ScrLk', long: 'Scroll Lock' },
  42: { short: 'Pause', long: 'Pause' },
  43: { short: 'Dir', long: 'Lighting direction' },
  44: { short: 'Color', long: 'Next light color' },
  60: { short: 'Light effect', long: 'Next light effect' },
  105: { short: 'Side fx', long: 'Side light effect (no side lights on the HE80)' },
  108: { short: 'Side clr', long: 'Side light color (no side lights on the HE80)' },
  49: { short: 'Win', long: 'Windows mode' },
  50: { short: 'Mac', long: 'Mac mode' },
  81: { short: 'Win lock', long: 'Win lock' },
  90: { short: 'Bri +', long: 'Brightness up' },
  89: { short: 'Bri −', long: 'Brightness down' },
  88: { short: 'Spd −', long: 'Light speed down' },
  91: { short: 'Spd +', long: 'Light speed up' },
}

/** F1–F12: the hub marks their Fn functions `fnDisabled`, i.e. not changeable, so neither do we. */
export const FN_FIXED = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
