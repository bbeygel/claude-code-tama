# Tama

A Tamagotchi that lives in Claude Code. It shows above the prompt and in the spinner, cheers up when Claude finishes a turn, sulks when a tool fails, gets hungry and sleepy on a real clock, grows from egg to adult, and dies if you leave it fainted for 24 hours.

Requires Claude Code v2.1.287 or later (mods).

## Install

```
/plugin marketplace add bbeygel/claude-code-tama
/plugin install tama@claude-code-tama
```

## Use

- `/pet` opens the device pane (a text card where panes don't draw, e.g. Remote Control).
- In the pane: `f` Feed, `s` Sleep/Wake, `p` Play, `Esc` close. Tab moves between buttons, Enter presses.
- `/pet name <name>` renames it.
- `/pet creature <description>` has a model draw your pet as that creature (one Opus call). `/pet creature default` restores it. Past the egg, a change restarts your pet as an egg (name kept), so you run it twice to confirm.
- `/feed`, `/sleep`, `/wake` work anywhere.

## Known issue

In terminals using the kitty keyboard protocol (Ghostty, cmux), the letter hotkeys don't fire. Use Tab and Enter.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed, see [LICENSE](LICENSE).
