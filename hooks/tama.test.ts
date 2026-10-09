import { expect, mock, test } from 'claude-code/testing'

import { type Action, type Grave, type Pet, ACTION_MS, ACTION_FRAME, CH, CW, HOME, ROUTINE_MS, STAGES, DEATH_AFTER, FRAME, advance, bury, canPlay, care, face, feed, grid, hatch, headstone, isDead, lcd, mode, moodBy, nameArg, pack, play, pose, parseCreature, quipIndex, rehatch, sleep, stage } from './tama'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const r = Math.round
const run = ($: any, command: string) =>
  $.command.run({ command, args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } })

test('10 h with no session open: state read back has lived through them', () => {
  const stored: Pet = JSON.parse(JSON.stringify(hatch(0))) // as $.store hands it back
  const p = advance(stored, 10 * HOUR)
  expect(p.lastSeen).toBe(10 * HOUR)
  expect(p.hunger).toBe(0) // 80 points at 1 per 6 min: empty at 8 h
  expect(r(p.faintedAt! / MIN)).toBe(480)
  expect(r(p.energy)).toBe(20)
  expect(r(p.mood)).toBe(30)
  expect(r(p.neglect / MIN)).toBe(120)
  expect(mode(p, false)).toBe('fainted')
  expect(advance(p, 10 * HOUR + 59_999)).toEqual(p) // under a minute: nothing, the rest carries over
})

test('a stored pet lives through 10 h of no session, read back via /pet', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, { pet: hatch(0) })
  await clock.advance(10 * HOUR)
  const out = await run($, 'pet')
  expect(out.text).toContain('(x_x)  Tama · baby · awake')
  expect(out.text).toContain('energy  [#----] 20')
  expect(out.text).toContain('Fainted! /feed to revive.')
})

test('/feed: +2 mood when it fits, half the overflow off when it spills, revives a fainted pet', () => {
  const p = hatch(0)
  expect(feed({ ...p, hunger: 50 })).toMatchObject({ hunger: 75, mood: 82 })
  expect(feed({ ...p, hunger: 80 })).toMatchObject({ hunger: 100, mood: 77.5 })
  expect(feed({ ...p, hunger: 100 })).toMatchObject({ hunger: 100, mood: 67.5 })
  expect(feed({ ...p, hunger: 0, faintedAt: 5 })).toMatchObject({ hunger: 25, mood: 82, faintedAt: null })
})

test('sleep: refused while awake above 50 energy', () => {
  const p = { ...hatch(0), energy: 51 }
  expect(sleep(p)).toBe(p)
  expect(sleep({ ...p, energy: 50 }).asleep).toBe(true)
  expect(sleep({ ...p, asleep: true }).asleep).toBe(true)
})

test('play: gain from mood and energy before the game, costs 5 energy and 3 hunger; refused asleep, fainted or hungry', () => {
  const p = hatch(0)
  expect(play({ ...p, mood: 20, energy: 80, hunger: 80 })).toMatchObject({ mood: 28, energy: 75, hunger: 77 })
  expect(play({ ...p, mood: 90, energy: 10, hunger: 80 })).toMatchObject({ mood: 83.5, energy: 5, hunger: 77 })
  expect(play({ ...p, energy: 3 }).energy).toBe(0)
  expect(canPlay({ ...p, hunger: 30 })).toBe(true)
  expect(play({ ...p, hunger: 30 }).hunger).toBe(27)
  for (const q of [{ ...p, hunger: 29 }, { ...p, asleep: true }, { ...p, faintedAt: 5 }]) {
    expect(canPlay(q)).toBe(false)
    expect(play(q)).toBe(q)
  }
})

const NO_SLEEP = /^\(  \) Tama: "(I'm not tired!|Stop making me go to bed!|Bed\? It's not even dark\.|Five more minutes… of being awake\.)"$/
// The stored pet as the card shows it (sdk origin: no pane).
const shown = async ($: any) => (await run($, 'pet')).text as string

test('/sleep: a rested pet says no and stays awake', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { pet: { ...hatch(0), energy: 80 } })
  const card = await shown($)
  expect((await run($, 'sleep')).text).toMatch(NO_SLEEP)
  expect(await shown($)).toBe(card)
  expect(card).toContain('awake')
})

test('/sleep: a tired pet goes to bed; /wake gets it up', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { pet: { ...hatch(0), energy: 40 } })
  expect((await run($, 'sleep')).text).toMatch(/^\(  \) zzz Tama: "(Night night\.|Lights out!)"$/)
  expect(await shown($)).toContain('asleep')
  expect((await run($, 'wake')).text).toMatch(/^\(  \) Tama: "(Morning!|I'm up, I'm up\.)"$/)
})

test('/play: two in a row read differently and carry the signed mood change', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { pet: { ...hatch(0), mood: 20, energy: 80 } })
  const a: string = (await run($, 'play')).text
  const b: string = (await run($, 'play')).text
  expect(a).toMatch(/^\(  \) Tama: "(Again! Again!|Best game ever!|Wheee!)" mood \+8$/)
  expect(b).toMatch(/: "(Again! Again!|Best game ever!|Wheee!)" mood \+7$/)
  expect(a.split('"')[1]).not.toBe(b.split('"')[1])
})

test('/play tired and happy: mood goes down, shown with a minus', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { pet: { ...hatch(0), mood: 90, energy: 10 } })
  expect((await run($, 'play')).text).toMatch(/: "(So… sleepy…|Can we stop now\?)" mood −7$/)
})

test('/play while hungry: refused, stats unchanged', async ($, on) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { pet: { ...hatch(0), hunger: 29 } })
  const card = await shown($)
  expect((await run($, 'play')).text).toMatch(/: "(Too hungry to play…|Snack first, then games\.|My tummy says no\.)"$/)
  expect(await shown($)).toBe(card)
})

const reply = async ($: any, on: any, pet: Pet, command: string) => {
  mock.clock(on, { now: 0 })
  mock.store(on, { pet })
  return (await run($, command)).text as string
}

test('/feed replies: yum when it fits, stuffed when it spills, back when fainted', async ($, on) => {
  expect(await reply($, on, { ...hatch(0), hunger: 50 }, 'feed')).toMatch(/^\(  \) Tama: "(Yum!|Nom nom nom\.|My favorite!)"$/)
})
test('/feed reply when it spills', async ($, on) => {
  expect(await reply($, on, { ...hatch(0), hunger: 90 }, 'feed')).toMatch(/: "(I'm stuffed…|No more, please!|Ugh, my tummy\.)"$/)
})
test('/feed reply when fainted', async ($, on) => {
  expect(await reply($, on, { ...hatch(0), hunger: 0, faintedAt: 0 }, 'feed')).toMatch(/: "Food! I'm back!"$/)
})
test('/play reply when asleep', async ($, on) => {
  expect(await reply($, on, { ...hatch(0), asleep: true }, 'play')).toMatch(/: "(zzz…|Shh, dreaming\.)"$/)
})
test('/play reply when fainted', async ($, on) => {
  expect(await reply($, on, { ...hatch(0), faintedAt: 0 }, 'play')).toMatch(/: "…" Out cold\. Feed it!$/)
})

// The pane up (so animations run), then a button pressed: the pane's texts and button labels before and after, and the toast.
const press = async ($: any, on: any, pet: Pet, key: string) => {
  mock.clock(on, { now: HOUR })
  mock.store(on, { pet })
  const toasts: string[] = []
  on('session.surfaces', async () => ({ value: ['terminal'] }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async (_: any, e: any) => (toasts.push(e.text), { value: undefined }))
  await $.command.run({ command: 'pet', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const props = { title: 'Tama', isFocused: true, bodyColumns: 31, placement: 'dock', scroll: { offset: 0, bodyRows: 21 }, view: {} }
  const mount = () => $.ui.mount({ plugin: 'tama', surface: 'terminal', component: 'Pane', requestId: 'tama', props })
  const texts = async () => {
    const ui = await mount()
    const t: string[] = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map((x: any) => x.text)
    await ui.unmount()
    return t
  }
  const before = await texts()
  const ui = await mount()
  await ui.press({ key })
  await ui.unmount()
  return { before, after: await texts(), toast: toasts.at(-1) }
}
// The LCD rows of the pane's texts: between the `┌` and `└` border rows, less the side rims.
const screen = (t: string[]) => t.slice(t.indexOf('│  ┌') + 3, t.indexOf('│  └')).filter(x => x !== '│  │')
const drawn = (lines: string[]) => lines.map(l => l.padEnd(21).slice(0, 21))

test('Play pressed on the pane while hungry: no ball, stats unchanged', async ($, on) => {
  const { before, after } = await press($, on, { ...hatch(HOUR), hunger: 20 }, 'play')
  expect(after).toEqual(before)
})

test('Play pressed on the pane when fed: the ball animates', async ($, on) => {
  const p = { ...hatch(HOUR), hunger: 80 }
  const { after } = await press($, on, p, 'play')
  const ball: Action = { kind: 'play', startedAt: HOUR }
  expect(screen(after)).toEqual(drawn(lcd(play(p), HOUR, ball)))
  expect(screen(after)).not.toEqual(drawn(lcd(play(p), HOUR)))
})

test('Sleep pressed on the pane while rested: refused, stays awake', async ($, on) => {
  const { after, toast } = await press($, on, { ...hatch(HOUR), energy: 80 }, 'sleep')
  expect(toast).toMatch(NO_SLEEP)
  expect(after).toContain('Sleep')
})

test('Wake pressed on the pane while asleep: wakes', async ($, on) => {
  const { before, after, toast } = await press($, on, { ...hatch(HOUR), asleep: true }, 'sleep')
  expect(toast).toMatch(/^\(  \) Tama: "(Morning!|I'm up, I'm up\.)"$/)
  expect(before).toContain('Wake')
  expect(after).toContain('Sleep')
})

// hatch(0) left alone: hunger hits 0 at 8 h, so it dies at 8 h + 24 h fainted.
const DIES = 8 * HOUR + DEATH_AFTER

test('death after 24 h fainted; its clock stops there', () => {
  expect(DEATH_AFTER).toBe(24 * HOUR)
  expect(isDead(advance(hatch(0), DIES - MIN), DIES - MIN)).toBe(false)
  expect(isDead(advance(hatch(0), DIES), DIES)).toBe(true)
  expect(advance(hatch(0), 100 * HOUR).lastSeen).toBe(DIES)
})

test('no revive once dead: /feed, /sleep and /wake answer "gone" and change nothing', async ($, on) => {
  mock.clock(on, { now: DIES + HOUR })
  mock.store(on, { pet: { ...hatch(0), name: 'Mochi' } })
  for (const c of ['feed', 'sleep', 'wake']) expect((await run($, c)).text).toBe('Mochi is gone.')
  expect((await run($, 'pet')).text).toContain('| Mochi |') // still a gravestone after /feed
})

test('/pet on a dead pet shows its gravestone and hatches a fresh egg', async ($, on) => {
  mock.clock(on, { now: DIES + HOUR })
  mock.store(on, { pet: { ...hatch(0), name: 'Mochi' } })
  const text: string = (await run($, 'pet')).text
  expect(text).toContain('| Mochi |')
  expect(text).toContain('| baby  |')
  expect(text).toContain('A new egg appears.')
  // the egg is stored: a second /pet shows it newborn, with the grave kept
  const again: string = (await run($, 'pet')).text
  expect(again).toContain('(  )  Tama · egg · awake\nage     0m')
  expect(again).toContain('Graveyard\n  Mochi · baby · 1d 8h')
  expect(again).not.toContain('RIP')
})

test('graveyard keeps the newest 5; headstone layout', () => {
  let graves: Grave[] = []
  for (let i = 1; i <= 7; i++) graves = bury({ ...hatch(0), name: `P${i}`, faintedAt: 0 }, graves, 0).graves
  expect(graves.map(g => g.name)).toEqual(['P7', 'P6', 'P5', 'P4', 'P3'])
  expect(headstone({ name: 'Mochi', stage: 'teen', born: 0, died: 3 * DAY + 4 * HOUR })).toEqual([
    ' .-----. ',
    '/       \\',
    '|  RIP  |',
    '| Mochi |',
    '| teen  |',
    '| 3d 4h |',
    '|_______|',
  ])
})

test('/sleep and /wake: recovery, half hunger, self-wake at 100', () => {
  const asleep = advance({ ...hatch(0), asleep: true, energy: 90 }, 20 * MIN)
  expect(r(asleep.energy)).toBe(97)
  expect(r(asleep.hunger * 12)).toBe(80 * 12 - 20)
  expect(asleep.mood).toBe(80) // mood rests too
  expect(face(asleep, 20 * MIN, false)).toBe('(-_-) zzz')
  const woke = advance({ ...hatch(0), asleep: true, energy: 90 }, 40 * MIN)
  expect(woke.asleep).toBe(false)
  expect(r(woke.energy)).toBe(99) // full at ~30 min, then awake ~10 min draining
})

test('tired: low energy shows tired and drains mood 3x', () => {
  const p = advance({ ...hatch(0), energy: 10 }, HOUR)
  expect(r(p.mood)).toBe(65)
  expect(mode(p, true)).toBe('tired')
})

test('turns cheer, errors sulk', () => {
  expect(moodBy(hatch(0), 2).mood).toBe(82)
  expect(moodBy({ ...hatch(0), mood: 1 }, -3).mood).toBe(0)
})

test('stages grow with cared-for time; neglect past 2 h pauses growth', () => {
  const p = hatch(0)
  const at = (t: number, q: Pet = p) => stage(q, t)
  expect([at(5 * MIN), at(HOUR), at(2 * DAY), at(5 * DAY), at(8 * DAY)]).toEqual(['egg', 'baby', 'child', 'teen', 'adult'])
  expect(at(7 * DAY + 30 * MIN, { ...p, neglect: 3 * HOUR })).toBe('teen') // 1 h over the allowance doesn't count
  expect(care({ ...p, neglect: 5 * DAY }, 15 * DAY)).toBe(67)
  expect(at(15 * DAY, { ...p, neglect: 5 * DAY })).toBe('scruffy')
  expect(at(14 * DAY, { ...p, neglect: 4 * DAY })).toBe('adult')
})

test('faces per stage and mood', () => {
  const p = hatch(0)
  expect(face(p, 0, false)).toBe('(  )')
  expect(face(p, HOUR, false)).toBe('(^_^)')
  expect(face(p, HOUR, true)).toBe('(o_o)')
  expect(face({ ...p, hunger: 20 }, 2 * DAY, false)).toBe('o(>_<)o')
  expect(face({ ...p, mood: 30 }, 5 * DAY, false)).toBe('d(;_;)b')
  expect(face(p, 8 * DAY, false)).toBe('\\(^_^)/')
  expect(face({ ...p, neglect: 5 * DAY, faintedAt: 1 }, 15 * DAY, false)).toBe('~(x_x)~')
})

test('/pet name and quip rotation', () => {
  expect(nameArg('name  Mochi ')).toBe('Mochi')
  expect(nameArg('')).toBe(undefined)
  expect(nameArg('name')).toBe(undefined)
  expect(quipIndex(19_999, 40)).toBe(0)
  expect(quipIndex(20_000, 40)).toBe(1)
  expect(quipIndex(40 * 20_000, 40)).toBe(0)
})

test('pane LCD: braille pixel art, bob, tomb; a feed action animates then returns to idle', () => {
  expect(pack(['#.#.', '##..', '.#..', '....', '.#', '..', '..', '..'])).toEqual(['⠳⠁', '⠈ '])
  const p = hatch(0), at = HOUR
  const idle = lcd(p, at)
  expect(idle).toHaveLength(7)
  expect(idle.every(l => l.length <= 21)).toBe(true)
  const z = { ...p, asleep: true }
  expect(lcd(z, at)[3]).toBe(lcd(z, at + 1700)[3])
  expect(lcd({ ...p, faintedAt: 0 }, DEATH_AFTER)[2]).toMatch(/[⠀-⣿]/)
  const a = { kind: 'feed' as const, startedAt: at }
  const frames = [0, 250, 1300, 2000].map(ms => lcd(p, at + ms, a).join('\n'))
  expect(new Set(frames).size).toBe(4)
  expect(lcd(p, at + ACTION_MS, a)).toEqual(lcd(p, at + ACTION_MS))
})

test('idle routines: x moves, stays on the canvas, never jumps; asleep stays still', () => {
  const xs = Array.from({ length: 400 }, (_, i) => pose(i * ACTION_FRAME)[0])
  expect(new Set(xs).size).toBeGreaterThan(5)
  expect(xs.every(x => x >= 0 && x <= 18)).toBe(true)
  expect(xs.slice(1).every((x, i) => Math.abs(x - xs[i]!) <= 3)).toBe(true)
  expect(pose(ROUTINE_MS * 7)[0]).toBe(HOME) // slots start and end at home
  const z = { ...hatch(0), asleep: true }
  expect(new Set(xs.map((_, i) => lcd(z, HOUR + i * ACTION_FRAME).slice(1).join())).size).toBe(1)
})

test('creature grids: a good drawing passes, wrong size or characters are rejected; the LCD uses it', () => {
  const good = Array.from({ length: CH }, (_, y) => (y < 10 ? '.'.repeat(CW) : '#'.repeat(CW)))
  expect(grid(good)).toEqual(good)
  expect(grid(good.slice(1))).toBe(undefined) // too few rows
  expect(grid(good.map(r => r + '.'))).toBe(undefined) // too wide
  expect(grid(good.map((r, i) => (i === 12 ? r.replace('#', 'x') : r)))).toBe(undefined) // stray char
  expect(grid(Array(CH).fill('.'.repeat(CW)))).toBe(undefined) // blank
  const reply = '```json\n' + JSON.stringify(Object.fromEntries(STAGES.map(s => [s, good]))) + '\n```'
  const cr = parseCreature(reply, 'a fox')
  expect(() => parseCreature(reply.replace('baby', 'bab'), 'a fox')).toThrow('baby')
  expect(() => parseCreature('sorry, no', 'a fox')).toThrow('JSON')
  const p = hatch(0)
  expect(lcd(p, HOUR, undefined, cr)).not.toEqual(lcd(p, HOUR))
  expect(lcd(p, 0, undefined, cr)).toEqual(lcd(p, 0)) // the egg stays the built-in
})

test('a creature change re-hatches a grown pet as an egg, keeping its name', () => {
  const baby = { ...hatch(0), name: 'Molda', hunger: 40 }
  const r = rehatch(baby, HOUR)
  expect(stage(r, HOUR)).toBe('egg')
  expect(r.name).toBe('Molda')
  expect(r.hunger).toBe(80)
  const egg = hatch(0)
  expect(rehatch(egg, MIN)).toBe(egg)
})
