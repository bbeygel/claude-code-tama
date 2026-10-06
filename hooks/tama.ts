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
// Death switch, off until the owner decides: a pet fainted this long dies (e.g. 12 * HOUR).
export const DEATH_AFTER = Infinity

const clamp = (n: number) => Math.max(0, Math.min(100, n))

export const hatch = (now: number): Pet => ({
  name: 'Tama', born: now, hunger: 80, energy: 80, mood: 80, asleep: false, faintedAt: null, neglect: 0, lastSeen: now,
})

// Lazy: replays the wall time since lastSeen minute by minute, so hours with no session open count.
// ponytail: O(idle minutes) per read (a month idle is ~43k cheap steps); closed form if it ever shows up.
export const advance = (p: Pet, now: number): Pet => {
  let { hunger, energy, mood, asleep, faintedAt, neglect, lastSeen } = p
  for (; lastSeen + MIN <= now; lastSeen += MIN) {
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

export const feed = (p: Pet, now: number): Pet =>
  isDead(p, now) ? p : { ...p, hunger: clamp(p.hunger + 25), mood: clamp(p.mood + (p.hunger >= 90 ? -5 : 2)), faintedAt: null }

export const moodBy = (p: Pet, d: number): Pet => ({ ...p, mood: clamp(p.mood + d) })

export const care = (p: Pet, now: number) => (now > p.born ? Math.round(100 * (1 - p.neglect / (now - p.born))) : 100)

// Growth counts cared-for time: neglect beyond a 2 h allowance pauses it.
export const stage = (p: Pet, now: number) => {
  const g = now - p.born - Math.max(0, p.neglect - 2 * HOUR)
  return g < 10 * MIN ? 'egg' : g < DAY ? 'baby' : g < 3 * DAY ? 'child' : g < 7 * DAY ? 'teen' : care(p, now) >= 70 ? 'adult' : 'scruffy'
}

export const mode = (p: Pet, now: number, working: boolean) =>
  isDead(p, now) ? 'dead'
  : p.faintedAt !== null ? 'fainted'
  : p.asleep ? 'asleep'
  : p.hunger < 30 ? 'hungry'
  : p.energy < 20 ? 'tired'
  : working ? 'watching'
  : p.mood < 40 ? 'sad'
  : 'happy'

const EYES: Record<ReturnType<typeof mode>, string> = {
  dead: '+_+', fainted: 'x_x', asleep: '-_-', hungry: '>_<', tired: '=_=', watching: 'o_o', sad: ';_;', happy: '^_^',
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
  const m = mode(p, now, working)
  return `${FORMS[stage(p, now)](EYES[m])}${m === 'asleep' ? ' zzz' : ''}`
}

export const bar = (n: number) => `[${'#'.repeat(Math.round(n / 20)).padEnd(5, '-')}]`

export const quipIndex = (now: number, count: number) => Math.floor(now / 20_000) % count

export const speech = (p: Pet) => (p.mood >= 70 ? 'All done. That was fun!' : p.mood >= 40 ? 'Done. Your turn.' : 'Done. I feel a bit sad.')

// `/pet name <name>` -> the name, capped so the band stays one line.
export const nameArg = (args: string) => /^name\s+(.+)$/.exec(args.trim())?.[1]?.trim().slice(0, 20)

const age = (ms: number) => {
  const m = Math.floor(ms / MIN), h = Math.floor(m / 60), d = Math.floor(h / 24)
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`
}

export const card = (p: Pet, now: number) => {
  const s = stage(p, now)
  const r = Math.round
  return [
    `${face(p, now, false)}  ${p.name} · ${s === 'scruffy' ? 'scruffy adult' : s} · ${p.asleep ? 'asleep' : 'awake'}`,
    `age     ${age(now - p.born)}`,
    `hunger  ${bar(p.hunger)} ${r(p.hunger)}`,
    `energy  ${bar(p.energy)} ${r(p.energy)}`,
    `mood    ${bar(p.mood)} ${r(p.mood)}`,
    `care    ${care(p, now)}%`,
    ...(isDead(p, now) ? ['It is gone.'] : p.faintedAt !== null ? ['Fainted! /feed to revive.'] : []),
    ...(s === 'egg' || s === 'baby' ? ['Name it: /pet name <name>'] : []),
  ].join('\n')
}
