import type { EngineInterface, Register } from 'claude-code'

import { QUIPS } from './quips'
import { type Grave, type Pet, advance, bar, bury, card, face, feed, hatch, headstone, isDead, moodBy, nameArg, quipIndex, speech, tomb } from './tama'

// Defaults under the stored value, so a field added later reads its default.
const load = async ($: EngineInterface, now: number) =>
  advance({ ...hatch(now), ...((await $.store.get('pet')) as Partial<Pet> | undefined) }, now)

// ponytail: read-modify-write on a store every session shares; last write wins, so two
// sessions writing at once can drop one change. Harmless for a toy; no upgrade planned.
const change = async ($: EngineInterface, fn: (p: Pet, now: number) => Pet) => {
  const now = await $.clock.now()
  const before = await load($, now)
  const after = isDead(before, now) ? before : fn(before, now) // nothing changes a dead pet
  await $.store.set('pet', after)
  $.ui.invalidate('ui.render')
  return { before, after, now }
}

// /feed, /sleep, /wake: a dead pet answers for all three.
const act = async ($: EngineInterface, fn: (p: Pet) => Pet, line: (b: Pet, a: Pet, now: number) => string) => {
  const { before, after, now } = await change($, fn)
  return { text: isDead(before, now) ? `${before.name} is gone.` : line(before, after, now) }
}

// Muted while it sleeps or lies fainted; speech failing never breaks a hook.
const say = async ($: EngineInterface, p: Pet, text: string) => {
  if (p.asleep || p.faintedAt !== null) return
  try {
    await $.audio.speak(text)
  } catch {}
}

const quip = (now: number, name: string) => QUIPS[quipIndex(now, QUIPS.length)]?.replaceAll('Tama', name)

const COMMANDS = [
  { name: 'pet', description: "Tama's status card", argumentHint: '[name <name>]', immediate: true },
  { name: 'feed', description: 'Feed Tama', immediate: true },
  { name: 'sleep', description: 'Lights off: Tama sleeps', immediate: true },
  { name: 'wake', description: 'Lights on: wake Tama', immediate: true },
] as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) await $.command.register(c)
    await change($, p => p) // persists the egg on first sight and the time simulated since
    // One redraw tick for the spinner quip and the idle band (lazy decay, quip rotation).
    $.clock.every(20_000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e) // subagent turns don't count
    const { after } = await change($, p => moodBy(p, 2))
    if (e.durationMs >= 20_000) void say($, after, speech(after))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.isError) await change($, p => moodBy(p, -3))
    return r
  })

  on('classic.Notification', async ($, e, next) => {
    void say($, await load($, await $.clock.now()), 'Hey, I need you.')
    return next(e)
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const now = await $.clock.now()
    const dead = await load($, now)
    if (isDead(dead, now)) {
      const b = bury(dead, ((await $.store.get('graves')) as Grave[] | undefined) ?? [], now)
      await $.store.set('pet', b.pet)
      await $.store.set('graves', b.graves)
      $.ui.invalidate('ui.render')
      return { text: [...headstone(b.graves[0]!), '', 'A new egg appears.', card(b.pet, now, b.graves)].join('\n') }
    }
    const name = nameArg(e.args)
    if (name) await change($, p => ({ ...p, name }))
    return { text: card(await load($, now), now, ((await $.store.get('graves')) as Grave[] | undefined) ?? []) }
  })

  on('command.run', { command: 'feed' }, $ =>
    act($, feed, (b, a, now) =>
      `${face(a, now, false)} ${b.name} ${b.faintedAt !== null ? 'comes round and eats!' : b.hunger >= 90 ? 'is stuffed and grumpy.' : 'munches happily.'}`),
  )

  on('command.run', { command: 'sleep' }, $ =>
    act($, p => ({ ...p, asleep: true }), (b, a, now) => `${face(a, now, false)} Lights off. ${a.name} is asleep.`),
  )

  on('command.run', { command: 'wake' }, $ => act($, p => ({ ...p, asleep: false }), (b, a, now) => `${face(a, now, false)} ${a.name} is up.`))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const now = await $.clock.now()
    const p = await load($, now)
    if (p.asleep || isDead(p, now)) return next(e)
    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} · ${quip(now, p.name)}` } })
  })

  // Compose: our rows on top, whatever the plugins beneath (or the engine) drew below.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const under = await next(e)
    if (e.props.hasSurvey) return under
    const now = await $.clock.now()
    const p = await load($, now)
    const { Box, Text } = $.ui.resolve(e)
    if (isDead(p, now))
      return (
        <Box flexDirection="column">
          {headstone(tomb(p)).map(l => (
            <Text dimColor>{l}</Text>
          ))}
          {under}
        </Box>
      )
    return (
      <Box flexDirection="column">
        <Text>{`${face(p, now, e.props.isWorking)} ${p.name}  hunger ${bar(p.hunger)}  energy ${bar(p.energy)}  mood ${bar(p.mood)}`}</Text>
        {e.props.isWorking || p.asleep ? null : <Text dimColor>{quip(now, p.name)}</Text>}
        {under}
      </Box>
    )
  })
}
