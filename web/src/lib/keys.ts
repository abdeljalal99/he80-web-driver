// HE80 key index map (docs/TECHNICAL.md, hub layout huafenda-compact-84-he80). Every per-key table uses these indices.
// usage = the key's default HID usage (0 for Fn). w = width, gap = space before the key, both in key units (u).
// ponytail: geometry is a standard 75% guess; adjust w/gap if it doesn't match the real board.

export interface Key { index: number; label: string; usage: number; w: number; gap: number }

type Row = [index: number, label: string, usage: number, w?: number, gap?: number][]

const RAW: Row[] = [
  [[0, 'Esc', 41], [1, 'F1', 58, 1, 0.2], [2, 'F2', 59], [3, 'F3', 60], [4, 'F4', 61], [5, 'F5', 62, 1, 0.2], [6, 'F6', 63],
    [7, 'F7', 64], [8, 'F8', 65], [9, 'F9', 66, 1, 0.2], [10, 'F10', 67], [11, 'F11', 68], [12, 'F12', 69],
    [103, 'Ins', 73, 1, 0.2], [106, 'Del', 76, 1, 0.2]],
  [[16, '`', 53], [17, '1', 30], [18, '2', 31], [19, '3', 32], [20, '4', 33], [21, '5', 34], [22, '6', 35], [23, '7', 36],
    [24, '8', 37], [25, '9', 38], [26, '0', 39], [27, '-', 45], [28, '=', 46], [92, 'Backspace', 42, 2], [104, 'Home', 74]],
  [[32, 'Tab', 43, 1.5], [33, 'Q', 20], [34, 'W', 26], [35, 'E', 8], [36, 'R', 21], [37, 'T', 23], [38, 'Y', 28], [39, 'U', 24],
    [40, 'I', 12], [41, 'O', 18], [42, 'P', 19], [43, '[', 47], [44, ']', 48], [60, '\\', 49, 1.5], [105, 'PgUp', 75]],
  [[48, 'Caps', 57, 1.75], [49, 'A', 4], [50, 'S', 22], [51, 'D', 7], [52, 'F', 9], [53, 'G', 10], [54, 'H', 11], [55, 'J', 13],
    [56, 'K', 14], [57, 'L', 15], [58, ';', 51], [59, "'", 52], [76, 'Enter', 40, 2.25], [108, 'PgDn', 78]],
  [[64, 'Shift', 225, 2.25], [65, 'Z', 29], [66, 'X', 27], [67, 'C', 6], [68, 'V', 25], [69, 'B', 5], [70, 'N', 17], [71, 'M', 16],
    [72, ',', 54], [73, '.', 55], [74, '/', 56], [75, 'Shift', 229, 1.75], [90, '↑', 82]],
  [[80, 'Ctrl', 224, 1.25], [81, 'Win', 227, 1.25], [82, 'Alt', 226, 1.25], [83, 'Space', 44, 6.25], [84, 'Alt', 230],
    [85, 'Fn', 0], [87, 'Ctrl', 228], [88, '←', 80], [89, '↓', 81], [91, '→', 79]],
]

export const ROWS: Key[][] = RAW.map(row => row.map(([index, label, usage, w = 1, gap = 0]) => ({ index, label, usage, w, gap })))

export const KEYS: Key[] = ROWS.flat()

const NAMES: Record<number, string> = {
  39: '0', 40: 'Enter', 41: 'Esc', 42: 'Backspace', 43: 'Tab', 44: 'Space', 45: '-', 46: '=', 47: '[', 48: ']', 49: '\\',
  51: ';', 52: "'", 53: '`', 54: ',', 55: '.', 56: '/', 57: 'Caps', 70: 'PrtSc', 71: 'ScrLk', 72: 'Pause', 73: 'Ins',
  74: 'Home', 75: 'PgUp', 76: 'Del', 77: 'End', 78: 'PgDn', 79: '→', 80: '←', 81: '↓', 82: '↑', 101: 'Menu',
  83: 'NumLk', 84: 'Num /', 85: 'Num *', 86: 'Num -', 87: 'Num +', 88: 'Num Enter', 98: 'Num 0', 99: 'Num .',
  224: 'LCtrl', 225: 'LShift', 226: 'LAlt', 227: 'LWin', 228: 'RCtrl', 229: 'RShift', 230: 'RAlt', 231: 'RWin',
}

/** Short display name for a HID keyboard usage (e.g. 0x6B → "F16"). */
export function usageName(u: number): string {
  if (u >= 4 && u <= 29) return String.fromCharCode(61 + u) // A–Z
  if (u >= 30 && u <= 38) return String(u - 29) // 1–9
  if (u >= 58 && u <= 69) return 'F' + (u - 57) // F1–F12
  if (u >= 104 && u <= 115) return 'F' + (u - 91) // F13–F24
  if (u >= 89 && u <= 97) return 'Num ' + (u - 88) // keypad 1–9
  return NAMES[u] ?? '0x' + u.toString(16)
}
