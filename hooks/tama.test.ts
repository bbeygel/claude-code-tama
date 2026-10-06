import { expect, mock, test } from 'claude-code/testing'

import { type Pet, DEATH_AFTER, advance, care, face, feed, hatch, mode, moodBy, nameArg, quipIndex, stage } from './tama'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const r = Math.round

test('10 h with no session open: state read back has lived through them', () => {
  const stored: Pet = JSON.parse(JSON.stringify(hatch(0))) // as $.store hands it back
  const p = advance(stored, 10 * HOUR)
  expect(p.lastSeen).toBe(10 * HOUR)
  expect(p.hunger).toBe(0) // 80 points at 1 per 6 min: empty at 8 h
  expect(r(p.faintedAt! / MIN)).toBe(480)
  expect(r(p.energy)).toBe(20)
  expect(r(p.mood)).toBe(30)
  expect(r(p.neglect / MIN)).toBe(120)
  expect(mode(p, 10 * HOUR, false)).toBe('fainted')
  expect(advance(p, 10 * HOUR + 59_999)).toEqual(p) // under a minute: nothing, the rest carries over
})

test('a stored pet lives through 10 h of no session, read back via /pet', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on, { pet: hatch(0) })
  await clock.advance(10 * HOUR)
  const out = await $.command.run({ command: 'pet', args: '', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(out.text).toContain('(x_x)  Tama · baby · awake')
  expect(out.text).toContain('energy  [#----] 20')
  expect(out.text).toContain('Fainted! /feed to revive.')
})

test('/feed: fills, overfeeding sulks, revives a fainted pet', () => {
  const p = hatch(0)
  expect(feed(p, 0).hunger).toBe(100)
  expect(feed(p, 0).mood).toBe(82)
  expect(feed({ ...p, hunger: 95 }, 0).mood).toBe(75)
  const back = feed({ ...p, hunger: 0, faintedAt: 5 }, HOUR)
  expect(back.faintedAt).toBe(null)
  expect(back.hunger).toBe(25)
  expect(DEATH_AFTER).toBe(Infinity) // death off: feeding always revives
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
  expect(mode(p, HOUR, true)).toBe('tired')
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
