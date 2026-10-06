export type Pet = {
  name: string
  born: number
  hunger: number // 100 full, 0 starving (faints)
  energy: number
  mood: number
  asleep: boolean
  faintedAt: number | null
  neglect: number // ms spent at hunger 0 or energy 0
  lastSeen: number // simulated up to here
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// A pet fainted this long dies; Infinity switches death off.
export const DEATH_AFTER = 24 * HOUR

const clamp = (n: number) => Math.max(0, Math.min(100, n))

export const hatch = (now: number): Pet => ({
  name: 'Tama', born: now, hunger: 80, energy: 80, mood: 80, asleep: false, faintedAt: null, neglect: 0, lastSeen: now,
})

// Lazy: replays the wall time since lastSeen minute by minute, so hours with no session open count.
// ponytail: O(idle minutes) per read (a month idle is ~43k cheap steps); closed form if it ever shows up.
export const advance = (p: Pet, now: number): Pet => {
  let { hunger, energy, mood, asleep, faintedAt, neglect, lastSeen } = p
  for (; lastSeen + MIN <= now; lastSeen += MIN) {
    if (faintedAt !== null && lastSeen >= faintedAt + DEATH_AFTER) break // dead: its clock stops
    if (hunger === 0 || energy === 0) neglect += MIN // a minute that starts at 0 is neglected
    hunger = clamp(hunger - (asleep ? 1 / 12 : 1 / 6)) // 1 pt / 6 min awake, half that asleep
    energy = clamp(energy + (asleep ? 1 / 3 : -1 / 10)) // +1 / 3 min asleep, -1 / 10 min awake
    if (asleep && energy >= 100) asleep = false
    if (!asleep) mood = clamp(mood - (energy < 20 ? 1 / 4 : 1 / 12)) // tired drains mood 3x
    if (hunger === 0) faintedAt ??= lastSeen + MIN
  }
  return { ...p, hunger, energy, mood, asleep, faintedAt, neglect, lastSeen }
}

export const isDead = (p: Pet, now: number) => p.faintedAt !== null && now - p.faintedAt >= DEATH_AFTER

export type Grave = { name: string; stage: string; born: number; died: number }

const label = (s: string) => (s === 'scruffy' ? 'scruffy adult' : s)

export const tomb = (p: Pet): Grave => {
  const died = (p.faintedAt ?? p.lastSeen) + DEATH_AFTER
  return { name: p.name, stage: label(stage(p, died)), born: p.born, died }
}

// /pet on a dead pet: a fresh egg, and the newest 5 graves kept.
export const bury = (p: Pet, graves: Grave[], now: number) => ({ pet: hatch(now), graves: [tomb(p), ...graves].slice(0, 5) })

export const headstone = (g: Grave) => {
  const rows = ['RIP', g.name, g.stage, age(g.died - g.born)]
  const w = Math.max(...rows.map(r => r.length)) + 2
  const mid = (r: string) => r.padStart(Math.floor((w + r.length) / 2)).padEnd(w)
  return [` .${'-'.repeat(w - 2)}. `, `/${' '.repeat(w)}\\`, ...rows.map(r => `|${mid(r)}|`), `|${'_'.repeat(w)}|`]
}

export const feed = (p: Pet): Pet => ({ ...p, hunger: clamp(p.hunger + 25), mood: clamp(p.mood + (p.hunger >= 90 ? -5 : 2)), faintedAt: null })

export const moodBy = (p: Pet, d: number): Pet => ({ ...p, mood: clamp(p.mood + d) })

// The pane's Play button: a game cheers it up, unless it sleeps or lies fainted.
export const play = (p: Pet): Pet => (p.asleep || p.faintedAt !== null ? p : moodBy(p, 10))

export const care = (p: Pet, now: number) => (now > p.born ? Math.round(100 * (1 - p.neglect / (now - p.born))) : 100)

// Growth counts cared-for time: neglect beyond a 2 h allowance pauses it.
export const stage = (p: Pet, now: number) => {
  const g = now - p.born - Math.max(0, p.neglect - 2 * HOUR)
  return g < 10 * MIN ? 'egg' : g < DAY ? 'baby' : g < 3 * DAY ? 'child' : g < 7 * DAY ? 'teen' : care(p, now) >= 70 ? 'adult' : 'scruffy'
}

export const mode = (p: Pet, working: boolean) =>
  p.faintedAt !== null ? 'fainted'
  : p.asleep ? 'asleep'
  : p.hunger < 30 ? 'hungry'
  : p.energy < 20 ? 'tired'
  : working ? 'watching'
  : p.mood < 40 ? 'sad'
  : 'happy'

const EYES: Record<ReturnType<typeof mode>, string> = {
  fainted: 'x_x', asleep: '-_-', hungry: '>_<', tired: '=_=', watching: 'o_o', sad: ';_;', happy: '^_^',
}
const FORMS: Record<ReturnType<typeof stage>, (e: string) => string> = {
  egg: () => '(  )',
  baby: e => `(${e})`,
  child: e => `o(${e})o`,
  teen: e => `d(${e})b`,
  adult: e => `\\(${e})/`,
  scruffy: e => `~(${e})~`,
}

export const face = (p: Pet, now: number, working: boolean) => {
  const m = mode(p, working)
  return `${FORMS[stage(p, now)](EYES[m])}${m === 'asleep' ? ' zzz' : ''}`
}

// The /pet pane's LCD: a mood bubble over a 42x24 pixel canvas packed into braille rows
// (2x4 dots per cell); awake, it runs a random idle routine every ROUTINE_MS; asleep, fainted and dead lie still.
export const FRAME = 1000
export type Action = { kind: 'feed' | 'play'; startedAt: number }
export const ACTION_MS = 2500
export const ACTION_FRAME = 250
export const ROUTINE_MS = 6000
export const HOME = 9 // sprite x at rest: 0..18 fits the 24-wide sprite in 42 dots
// Idle routines, u in [0,1) through the slot: [dx, dy] off home, 0 at both ends so they chain without a jump.
const ROUTINES: ((u: number) => [number, number])[] = [
  u => [9 * Math.sin(2 * Math.PI * u), 0], // walk right, back, left, back
  u => [0, -6 * Math.abs(Math.sin(3 * Math.PI * u))], // three hops
  u => [3 * Math.sin(4 * Math.PI * u), 0], // look around
  () => [0, 0], // rest
  u => [2 * Math.sin(6 * Math.PI * u), -(Math.floor(12 * u) % 2)], // dance
]
// Pure in now: the slot's hash picks the routine, the time within it the pose.
export const pose = (now: number) => {
  const k = Math.floor(now / ROUTINE_MS)
  const [dx, dy] = ROUTINES[(Math.imul(k, 2654435761) >>> 16) % ROUTINES.length]!((now / ROUTINE_MS) % 1)
  return [HOME + Math.round(dx), Math.round(dy)] as const
}
// Eight pixels -> one braille cell (a blank one is a plain space): dot bits by [row][col].
const DOTS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
export const pack = (rows: string[]) =>
  Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) =>
    Array.from({ length: Math.ceil(rows[0]!.length / 2) }, (_, j) => {
      const n = DOTS.reduce((a, d, dy) => a + d.reduce((b, bit, dx) => b + (rows[4 * i + dy]?.[2 * j + dx] === '#' ? bit : 0), 0), 0)
      return n ? String.fromCharCode(0x2800 + n) : ' '
    }).join(''),
  )
// A pet drawn by a model: one 24x24 grid per grown stage (the egg stays the built-in one).
export const CW = 24, CH = 24
export const STAGES = ['baby', 'child', 'teen', 'adult', 'scruffy'] as const
export type Creature = { desc: string; sprites: Record<(typeof STAGES)[number], string[]> }
// Model output is untrusted: a grid is CH strings of CW '#'/'.', with some ink; anything else is undefined.
export const grid = (g: unknown) =>
  Array.isArray(g) && g.length === CH && g.every(r => typeof r === 'string' && r.length === CW && /^[#.]+$/.test(r)) && g.some(r => r.includes('#')) ? (g as string[]) : undefined
// The first {...} of a reply (it may wear a code fence), every stage's grid checked; throws why not.
export const parseCreature = (text: string, desc: string): Creature => {
  let raw: Record<string, unknown> | undefined
  try {
    raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch {}
  if (!raw || typeof raw !== 'object') throw new Error('the model did not answer with JSON')
  const bad = STAGES.find(s => !grid(raw[s]))
  if (bad) throw new Error(`its ${bad} drawing was not a ${CW}x${CH} grid of # and .`)
  return { desc, sprites: Object.fromEntries(STAGES.map(s => [s, raw[s]])) as Creature['sprites'] }
}
export const drawPrompt = (desc: string) =>
  `Draw ${JSON.stringify(desc)} as a tiny 8-bit pixel-art pet, front view, in five growth stages: baby, child, teen, adult, scruffy (a shaggy, unkempt adult). ` +
  `Reply with ONLY a JSON object {"baby":[...],"child":[...],"teen":[...],"adult":[...],"scruffy":[...]}. ` +
  `Each value is an array of exactly ${CH} strings of exactly ${CW} characters, only '#' (ink) and '.' (blank): an outlined single-color sprite with a face, centered, ` +
  `standing on the bottom row, at most ${CW - 2} wide, bigger and more detailed with each stage.`

// Built-in sprites, drawn 24x20 and set on the floor of the 24x24 canvas, from an outlined oval plus parts; stamped OR-wise so parts may overlap.
const oval = (w: number, h: number) => {
  const i = (x: number, y: number) => ((x + 0.5) / w * 2 - 1) ** 2 + ((y + 0.5) / h * 2 - 1) ** 2 <= 1
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (i(x, y) && !(i(x - 1, y) && i(x + 1, y) && i(x, y - 1) && i(x, y + 1)) ? '#' : '.')).join(''))
}
const box = (w: number, h: number) => Array<string>(h).fill('#'.repeat(w))
const stamp = (g: string[], art: string[], x: number, y: number) =>
  art.forEach((r, i) => void (g[y + i] !== undefined && (g[y + i] = [...g[y + i]!].map((c, j) => (j >= x && r[j - x] === '#' ? '#' : c)).join(''))))
// [art, x, y] parts onto a blank canvas; fx, fy: where the 9x5 face goes.
const build = (parts: [string[], number, number][], fx = 0, fy = 0) => {
  const g = Array<string>(CH).fill('.'.repeat(CW))
  parts.forEach(([a, x, y]) => stamp(g, a, x, y + CH - 20))
  return { g, fx, fy }
}
const EAR = ['#..', '##.', '###'], EAR_R = EAR.map(r => [...r].reverse().join(''))
const SPRITES: Record<ReturnType<typeof stage>, ReturnType<typeof build>> = {
  egg: build([[oval(14, 18), 5, 2], [['..#...', '.#.#..', '#...#.'], 9, 8], [['.#', '##'], 8, 16], [['#.', '##'], 14, 5], [['.#.', '###'], 11, 14]]),
  baby: build([[['#.#', '.#.'], 11, 4], [oval(14, 12), 5, 6], [box(4, 2), 7, 18], [box(4, 2), 13, 18]], 7, 9),
  child: build([[EAR, 5, 1], [EAR_R, 16, 1], [oval(16, 14), 4, 4], [box(5, 2), 6, 18], [box(5, 2), 13, 18]], 8, 7),
  teen: build([[EAR, 4, 0], [EAR_R, 17, 0], [oval(18, 15), 3, 3], [['##', '#.', '#.'], 1, 10], [['##', '.#', '.#'], 21, 10], [box(6, 2), 5, 18], [box(6, 2), 13, 18]], 7, 7),
  adult: build([[EAR, 3, 0], [EAR_R, 18, 0], [oval(20, 16), 2, 2], [['.##', '#..', '#..', '#..'], 0, 9], [['##.', '..#', '..#', '..#'], 21, 9], [box(7, 2), 4, 18], [box(7, 2), 13, 18], [['.#.#.', '#.#.#'], 9, 0]], 7, 6),
  scruffy: build([[['#.#.#.#.#.#.#', '.###########.'], 5, 1], [oval(18, 15), 3, 3], [['#.', '.#', '#.'], 1, 7], [['.#', '#.', '.#'], 21, 7], [['#.#.', '.#.#'], 3, 18], [['#.#.', '.#.#'], 17, 18], [box(5, 1), 7, 19], [box(5, 1), 13, 19]], 7, 8),
}
const FACES: Record<ReturnType<typeof mode>, string[]> = {
  happy: ['.#.....#.', '#.#...#.#', '.........', '#.......#', '.#######.'],
  watching: ['##.....##', '##.....##', '.........', '...###...', '...###...'],
  sad: ['.#.....#.', '.##...##.', '.........', '..#####..', '.#.....#.'],
  tired: ['.........', '###...###', '#.#...#.#', '.........', '..#####..'],
  hungry: ['#.......#', '.#.....#.', '#.......#', '..#####..', '...###...'],
  asleep: ['.........', '.........', '###...###', '.........', '...###...'],
  fainted: ['#.#...#.#', '.#.....#.', '#.#...#.#', '.........', '..#####..'],
}
const BUBBLES: Record<ReturnType<typeof mode>, [string, string]> = {
  happy: ['♪', '  ♪'], watching: ['?', '?'], sad: ['...', '..'], tired: ['yawn', 'yawn'], hungry: ['hungry!', 'hungry!'], asleep: ['z', 'zZ'], fainted: ['@', '@ @'],
}
const TOMB = ['....########....', '..##........##..', '.#............#.', '#......##......#', '#......##......#', '#....######....#', '#....######....#', '#......##......#', '#......##......#', '#......##......#', ...Array<string>(9).fill('#..............#'), '################']
const BOWL = ['#.......#', '#.......#', '.#######.']
const FOOD = [[], ['..#####..'], ['...###...', '..#####..'], ['....#....', '...###...', '..#####..']] // the heap, by level left
const BALL = ['.###.', '#.#.#', '#####', '#.#.#', '.###.']
const BOUNCE = [19, 13, 7, 13]

export const lcd = (p: Pet, now: number, action?: Action, cr?: Creature) => {
  const m = mode(p, false)
  const f = Math.floor(now / FRAME) % 2
  const still = m === 'asleep' || m === 'fainted'
  const g = Array<string>(CH).fill('.'.repeat(2 * 21))
  if (isDead(p, now)) return ['', ...pack((stamp(g, TOMB, 13, 4), g))]
  const s = stage(p, now)
  const t = action ? now - action.startedAt : -1
  const k = Math.floor(t / ACTION_FRAME)
  const on = t >= 0 && t < ACTION_MS
  const [x, py] = still ? [HOME, 0] : on ? [3, 0] : pose(now) // a Feed/Play action pins it left of the props
  let face = FACES[m]
  const sp = SPRITES[s]
  stamp(g, cr && s !== 'egg' ? cr.sprites[s] : sp.g, x, py)
  if (on && action!.kind === 'feed') {
    const food = FOOD[3 - Math.floor((4 * t) / ACTION_MS)]!
    stamp(g, food, 32, 21 - food.length)
    stamp(g, BOWL, 32, 21)
    face = FACES[k % 2 ? 'hungry' : 'happy'] // chewing
  } else if (on) {
    stamp(g, BALL, 34, BOUNCE[k % 4]!)
    face = FACES.happy
  }
  if (s !== 'egg' && !cr) stamp(g, face, x + sp.fx, sp.fy + CH - 20 + py)
  return [' '.repeat(13) + BUBBLES[m][f], ...pack(g)]
}

export const bar = (n: number) => `[${'#'.repeat(Math.round(n / 20)).padEnd(5, '-')}]`

export const quipIndex = (now: number, count: number) => Math.floor(now / 20_000) % count


// `/pet name <name>` -> the name, capped so the band stays one line.
export const nameArg = (args: string) => /^name\s+(.+)$/.exec(args.trim())?.[1]?.trim().slice(0, 20)

// `/pet creature <description>` -> the description, or 'default' to restore the built-in pet.
// A new creature starts over as an egg, keeping its name; an egg stays as it is.
export const rehatch = (p: Pet, now: number): Pet => (stage(p, now) === 'egg' ? p : { ...hatch(now), name: p.name })

export const creatureArg = (args: string) => /^creature\s+(.+)$/.exec(args.trim())?.[1]?.trim().slice(0, 60)

export const age = (ms: number) => {
  const m = Math.floor(ms / MIN), h = Math.floor(m / 60), d = Math.floor(h / 24)
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

export const card = (p: Pet, now: number, graves: Grave[] = []) => {
  const s = stage(p, now)
  const r = Math.round
  return [
    `${face(p, now, false)}  ${p.name} · ${label(s)} · ${p.asleep ? 'asleep' : 'awake'}`,
    `age     ${age(now - p.born)}`,
    `hunger  ${bar(p.hunger)} ${r(p.hunger)}`,
    `energy  ${bar(p.energy)} ${r(p.energy)}`,
    `mood    ${bar(p.mood)} ${r(p.mood)}`,
    `care    ${care(p, now)}%`,
    ...(p.faintedAt !== null ? ['Fainted! /feed to revive.'] : []),
    ...(s === 'egg' || s === 'baby' ? ['Name it: /pet name <name>'] : []),
    ...(graves.length ? ['Graveyard', ...graves.map(g => `  ${g.name} · ${g.stage} · ${age(g.died - g.born)}`)] : []),
  ].join('\n')
}
