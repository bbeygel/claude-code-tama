import type { CommandRunInput, EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import { QUIPS } from './quips'
import { type Action, type Creature, type Grave, type Pet, ACTION_FRAME, ACTION_MS, FRAME, advance, age, bar, bury, card, care, creatureArg, drawPrompt, face, feed, hatch, headstone, isDead, lcd, mode, moodBy, nameArg, parseCreature, play, quipIndex, rehatch, stage, tomb } from './tama'

// Raw Ink color names; the band and the pane are where a mod can color (a command reply is plain text).
const level = (n: number) => (n >= 60 ? 'green' : n >= 30 ? 'yellow' : 'red')
const FACE_COLOR: Record<ReturnType<typeof mode>, string> = {
  happy: 'magenta', watching: 'cyan', sad: 'blue', tired: 'yellow', hungry: 'red', asleep: 'gray', fainted: 'red',
}

// The /pet pane: an egg-shaped device, 29 cells at its widest, 21 rows.
const PANE = 'tama'
const SHELL = '#f48fb1'
const METERS = [['hunger', '♨', 'food'], ['energy', '☾', 'energy'], ['mood', '♥', 'mood']] as const
const center = (s: string, w: number) => {
  const t = s.slice(0, w)
  return t.padStart(Math.floor((w + t.length) / 2)).padEnd(w)
}
// ponytail: a module variable, so a hot reload with the pane up leaves the pet still until /pet again.
let anim: Timer | undefined
// The running Feed/Play animation; lcd ignores it once ACTION_MS have passed.
let action: Action | undefined

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

// /feed, /sleep, /wake and the pane's buttons: a dead pet answers for all.
const act = async ($: EngineInterface, fn: (p: Pet) => Pet, line: (b: Pet, a: Pet, now: number) => string, kind?: Action['kind']) => {
  const { before, after, now } = await change($, fn)
  // Animate only accepted actions, and only with the pane up (anim); a faster tick runs just meanwhile.
  if (kind && anim && !isDead(before, now) && !(kind === 'play' && (before.asleep || before.faintedAt !== null))) {
    action = { kind, startedAt: now }
    const t = $.clock.every(ACTION_FRAME, () => $.ui.invalidate('ui.render'))
    $.clock.after(ACTION_MS + ACTION_FRAME, () => t.cancel())
  }
  return { text: isDead(before, now) ? `${before.name} is gone.` : line(before, after, now) }
}
const fed = (b: Pet, a: Pet, now: number) =>
  `${face(a, now, false)} ${b.name} ${b.faintedAt !== null ? 'comes round and eats!' : b.hunger >= 90 ? 'is stuffed and grumpy.' : 'munches happily.'}`
const lights = (b: Pet, a: Pet, now: number) => `${face(a, now, false)} ${a.asleep ? `Lights off. ${a.name} is asleep.` : `${a.name} is up.`}`
const played = (b: Pet, a: Pet, now: number) =>
  `${face(a, now, false)} ${a.name} ${b.asleep ? 'is asleep.' : b.faintedAt !== null ? 'is out cold. Feed it!' : 'plays! mood +10'}`

// Asks a model to draw the creature; the pet changes only if every grid checks out.
const draw = async ($: EngineInterface, desc: string) => {
  try {
    const r = await $.model.complete({ model: 'opus', prompt: drawPrompt(desc), maxTokens: 16000, effort: 'low', timeoutMs: 180_000 })
    if (!r.isAnswered) throw new Error(`the model gave no drawing (${r.reason})`)
    await $.store.set('creature', parseCreature(r.text, desc))
    await change($, rehatch)
    $.ui.toast(`Tama is now ${desc}!`)
  } catch (err) {
    $.ui.toast(`Tama could not change into ${desc}: ${err instanceof Error ? err.message : err}. Kept the old look.`)
  }
}

const graves = async ($: EngineInterface) => ((await $.store.get('graves')) as Grave[] | undefined) ?? []

// A dead pet: its grave dug and a fresh egg laid. Undefined while it lives.
const burial = async ($: EngineInterface, now: number) => {
  const p = await load($, now)
  if (!isDead(p, now)) return
  const b = bury(p, await graves($), now)
  await $.store.set('pet', b.pet)
  await $.store.set('graves', b.graves)
  $.ui.invalidate('ui.render')
  return b
}

// The pane only where it draws: /pet typed at a terminal. Remote Control (bridge), -p and
// VS Code (sdk), or a pane left unplaced, answer false and the caller prints the card.
const openPane = async ($: EngineInterface, e: CommandRunInput) => {
  if (e.origin.kind !== 'composer' || !(await $.session.surfaces()).includes('terminal')) return false
  const { isPlaced } = await $.ui.open({ id: PANE, title: 'Tama', focus: true, closeOnEscape: true, rows: 21, columns: 31 })
  if (isPlaced) anim ??= $.clock.every(FRAME, () => $.ui.invalidate('ui.render')) // the bob; ui.close stops it
  return isPlaced
}

// A creature change re-hatches the pet, so past the egg it is asked twice: the
// first run warns, the same command again goes ahead. Per session.
let pending: string | undefined

const quip = (now: number, name: string) => QUIPS[quipIndex(now, QUIPS.length)]?.replaceAll('Tama', name)

const COMMANDS = [
  { name: 'pet', description: "Open Tama's device (its card where no pane draws)", argumentHint: '[name <name> | creature <description> | creature default]', immediate: true },
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
    await change($, p => moodBy(p, 2))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.isError) await change($, p => moodBy(p, -3))
    return r
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const now = await $.clock.now()
    const b = await burial($, now)
    if (b) {
      const shown = await openPane($, e)
      return { text: [...headstone(b.graves[0]!), '', 'A new egg appears.', ...(shown ? [] : [card(b.pet, now, b.graves)])].join('\n') }
    }
    const desc = creatureArg(e.args)
    if (desc) {
      const p = await load($, now)
      if (stage(p, now) !== 'egg' && pending !== desc) {
        pending = desc
        return { text: `Changing the creature resets ${p.name} to an egg. Run /pet ${e.args.trim()} again to confirm.` }
      }
      pending = undefined
    }
    if (desc === 'default') await $.store.delete('creature').then(() => change($, rehatch))
    else if (desc) void draw($, desc)
    const note = desc === 'default' ? 'Tama is back to its own shape.' : desc ? `Tama is changing into ${desc}…` : ''
    const name = nameArg(e.args)
    if (name) await change($, p => ({ ...p, name }))
    if (await openPane($, e)) return note ? { text: note } : {}
    return { text: [...(note ? [note] : []), card(await load($, now), now, await graves($))].join('\n') }
  })

  on('command.run', { command: 'feed' }, $ => act($, feed, fed, 'feed'))
  on('command.run', { command: 'sleep' }, $ => act($, p => ({ ...p, asleep: true }), lights))
  on('command.run', { command: 'wake' }, $ => act($, p => ({ ...p, asleep: false }), lights))

  on('ui.close', { id: PANE }, ($, e, next) => {
    anim?.cancel()
    anim = undefined
    return next(e)
  })

  // The device: shell rows around an LCD, meters and three buttons. Off the terminal, or
  // narrower than the egg, the card's lines and the same buttons.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const now = await $.clock.now()
    const p = await load($, now)
    const dead = isDead(p, now)
    const cr = (await $.store.get('creature')) as Creature | undefined
    const { Box, Text, Button } = $.ui.resolve(e)
    const press = (run: () => Promise<{ text: string }>) => async () => $.ui.toast((await run()).text)
    const buttons = dead ? (
      <Button key="bury" label="New egg" hotkey="b" plain autoFocus onPress={async () => void ((await burial($, await $.clock.now())) && $.ui.toast('A new egg appears.'))} />
    ) : (
      <Box columnGap={1}>
        <Button key="feed" label="Feed" hotkey="f" plain autoFocus onPress={press(() => act($, feed, fed, 'feed'))} />
        <Button key="sleep" label={p.asleep ? 'Wake' : 'Sleep'} hotkey="s" plain onPress={press(() => act($, q => ({ ...q, asleep: !q.asleep }), lights))} />
        <Button key="play" label="Play" hotkey="p" plain onPress={press(() => act($, play, played, 'play'))} />
      </Box>
    )
    if (e.surface !== 'terminal' || e.props.bodyColumns < 29)
      return (
        <Box flexDirection="column">
          {(dead ? headstone(tomb(p)) : card(p, now).split('\n')).map(l => (
            <Text>{l}</Text>
          ))}
          {buttons}
        </Box>
      )
    const rim = (l: string, r: string, mid: RenderElement) => (
      <Box>
        <Text color={SHELL}>{l}</Text>
        {mid}
        <Text color={SHELL}>{r}</Text>
      </Box>
    )
    const [bg, ink] = dead ? ['#9e9e9e', '#212121'] : p.asleep ? ['#1e3a1e', '#8bac0f'] : ['#9bbc0f', '#0f380f'] // lights off: dark LCD
    return (
      <Box flexDirection="column" alignItems="center" width={e.props.bodyColumns}>
        <Text color={SHELL}>{`╭${'─'.repeat(15)}╮`}</Text>
        {rim('╭──╯', '╰──╮', <Text color={SHELL} bold>{center('T A M A', 15)}</Text>)}
        {rim('╭─╯', '╰─╮', <Text bold>{center(`${p.name} · ${dead ? 'RIP' : stage(p, now)}`, 21)}</Text>)}
        {rim('╭╯', '╰╮', <Text dimColor>{center(dead ? 'rest in peace' : `age ${age(now - p.born)} · care ${care(p, now)}%`, 25)}</Text>)}
        {rim('│  ┌', '┐  │', <Text color={SHELL}>{'─'.repeat(21)}</Text>)}
        {lcd(p, now, action, cr).map(l =>
          rim('│  │', '│  │', <Text color={ink} backgroundColor={bg}>{l.padEnd(21).slice(0, 21)}</Text>),
        )}
        {rim('│  └', '┘  │', <Text color={SHELL}>{'─'.repeat(21)}</Text>)}
        {METERS.map(([k, icon, name]) => {
          const n = Math.round(p[k] / 10)
          return rim('│', '│', (
            <Text>
              {'  '}
              <Text color={level(p[k])}>{icon}</Text>
              {` ${name.padEnd(7)}`}
              <Text color={level(p[k])}>{'█'.repeat(n)}</Text>
              <Text dimColor>{'░'.repeat(10 - n)}</Text>
              {` ${String(Math.round(p[k])).padStart(3)}  `}
            </Text>
          ))
        })}
        {rim('│', '│', <Text>{' '.repeat(27)}</Text>)}
        {rim('╰╮', '╭╯', <Box width={25} justifyContent="center">{buttons}</Box>)}
        {rim('╰─╮', '╭─╯', <Text dimColor>{center('tab · enter · esc', 21)}</Text>)}
        {rim('╰──╮', '╭──╯', <Text>{' '.repeat(15)}</Text>)}
        <Text color={SHELL}>{`╰${'─'.repeat(15)}╯`}</Text>
      </Box>
    )
  })

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
        <Box flexDirection="row">
          <Text color={FACE_COLOR[mode(p, e.props.isWorking)]} bold>{`${face(p, now, e.props.isWorking)} `}</Text>
          <Text color="cyan" bold>{p.name}</Text>
          {(['hunger', 'energy', 'mood'] as const).map(k => (
            <Text>
              <Text dimColor>{`  ${k} `}</Text>
              <Text color={level(p[k])}>{bar(p[k])}</Text>
            </Text>
          ))}
        </Box>
        {e.props.isWorking || p.asleep ? null : <Text dimColor>{quip(now, p.name)}</Text>}
        {under}
      </Box>
    )
  })
}
