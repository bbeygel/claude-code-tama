# Contributing

Thanks for helping Tama grow. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Run it locally

You need Claude Code v2.1.287 or later.

```
git clone https://github.com/bbeygel/claude-code-tama
claude --plugin-dir ./claude-code-tama
```

Edit, then run `/reload-plugins` in that session to load your change.

## Before you open a PR

```
claude plugin validate .
claude plugin test .
```

Both run in CI and must pass before a PR can merge.

## Pull requests

- `main` only takes changes through pull requests.
- Keep a PR to one change, and say what it does and how you checked it.
- Pet logic goes in `hooks/tama.ts` as pure functions with a test in `hooks/tama.test.ts`. Hooks, commands and drawing go in `hooks/register.tsx`.
- Changing how Tama looks? Add a before/after capture of the pane.
- Releasing: bump `version` in `.claude-plugin/plugin.json`, or installed copies won't update.

## Issues

Use the bug or feature form. For a bug, include your Claude Code version (`claude --version`) and terminal app.

## License

Contributions are licensed under the [MIT License](LICENSE).
