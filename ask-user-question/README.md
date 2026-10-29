# ask-user-question

A Pi extension that lets the model ask you instead of guessing. It gives [Pi Agent](https://github.com/badlogic/pi-mono) one tool — `ask_user_question` — that opens a terminal dialog of up to four questions with written-out options, and hands your choices back as structured data. Install it if you would rather spend fifteen seconds picking than an hour undoing a wrong assumption.

Ported from [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) v2.15.0, with the config/i18n dependencies replaced by small built-in equivalents so the plugin runs with nothing beyond what Pi already provides.

## Install

```sh
pi install git:github.com/nickdevelop/pi-plugins
```

Restart your Pi session. If you only want this plugin, filter the package's extensions in
`~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/nickdevelop/pi-plugins",
      "extensions": ["ask-user-question/index.ts"]
    }
  ]
}
```

## Quick start

Nothing to set up — the tool is live as soon as Pi restarts. Hand the model a task with a real decision buried in it:

> Add caching to the API client.

Rather than picking a strategy on your behalf, the model calls `ask_user_question` and a dialog takes over the bottom of your terminal. Move with `↑`/`↓`, choose with `Enter`, press `n` to attach a note to a question or a global note from the Submit tab, or land on `Type something.` to answer in your own words. In a multi-select question, typed custom text is selected automatically and submitted together with checked options. While typing, `Shift+Enter` adds a line, `Ctrl+G` opens Pi's configured external editor, and `Ctrl+U` clears the draft; browsing another option and returning keeps what you wrote. `Esc` abandons the questionnaire entirely.

When the questionnaire begins waiting in an interactive TTY, it emits one standard terminal BEL (`\x07`). Your terminal configuration determines whether that appears as an audible alert, a visual alert, or nothing; redirected and non-TTY output is untouched.

When the model asks several things at once, `Tab` moves between them and a Submit tab reviews everything before it goes back.

## What you get

- **Typed options instead of a wall of prose** — each question carries 2-4 authored choices, and every choice comes with a description of what it means or what it costs you.
- **You can always answer in your own words**. A `Type something.` row is appended to every question. On multi-select questions, it keeps checked options and custom text in the same answer. The row widens to the full pane while you type, keeps its multiline draft visible while you browse, and supports Pi's `Shift+Enter` newline and `Ctrl+G` external-editor flows.
- **Compare real artifacts, not just labels** — an option can carry a markdown `preview` (ASCII mockup, code, diagram, config) that renders in a bordered box beside the option list.
- **One interruption, not five** — up to four questions arrive in a single tabbed dialog, and the Submit tab lists your answers and names anything still blank before you commit.
- **Notes on any answer — or on all of them** — `n` opens a multiline note editor on any question tab, and on the Submit tab it opens one global note for the whole questionnaire. Per-question notes reach the model as `user notes: <text>`, the global note as `global note: <text>`; neither marks a question answered.
- **Keep reading while you answer** — the question opens below the transcript, and `PageUp`/`PageDown` or the mouse wheel keep scrolling the conversation; `Ctrl+]` shrinks the dialog to one line when you want more room, then brings it back with your answers intact.
- **Works outside the terminal too** — in RPC and ACP hosts such as the VS Code pendant or Zed the questionnaire walks through the host's native dialogs (notes are terminal-only and do not carry over), and in non-interactive runs the tool is removed from the model's tool list instead of failing every call.
- **Localized chrome** — the nine shipped languages in `locales/` are picked from `PI_LANG`, `LC_ALL`, `LC_MESSAGES`, or `LANG`; untranslated keys fall back to English. See [docs/localization.md](./docs/localization.md).

## Configuration

Optional. Settings live in `~/.config/ask-user-question/config.json`; the file is read, never written. The pre-rename path `~/.config/rpiv-ask-user-question/config.json` is used as a fallback when the new file is absent, so a config carried over from the upstream package keeps working.

| Setting | What it does | Default |
| --- | --- | --- |
| `collapseKey` | Key that collapses and expands the dialog. Accepts Pi keybinding ids such as `alt+o`; `"off"` disables the shortcut. | `"ctrl+]"` |
| `notesKey` | Key that opens the notes editor. Any single character, including non-Latin ones such as `т`, or a Pi keybinding id such as `ctrl+n`. | `"n"` |
| `guidance.description` | Full replacement for the tool description the model sees. A non-empty string replaces the built-in text entirely — no merging. | built-in description |
| `guidance.promptSnippet` | One-line description of the tool in the system prompt — tune how eagerly the model asks. | built-in snippet |
| `guidance.promptGuidelines` | Usage guidelines given to the model, as a list of strings. | 4 built-in guidelines |

```json
{ "collapseKey": "alt+o" }
```

Malformed JSON falls back to the defaults with a warning; an individual unusable value is silently dropped back to its default. Never an error.

## Reference

- [Tool schema](./docs/tool-schema.md) — parameters, limits, reserved labels, validation errors, the result envelope, and the `rpiv:ask-user:prompt` event.
- [Keyboard and layout](./docs/keyboard.md) — every key, the rows the dialog appends, notes, collapse mode, and how previews and overflow adapt to terminal size.
- [Configuration](./docs/configuration.md) — file lookup and `XDG_CONFIG_HOME`, the `collapseKey` grammar, the `guidance.*` prompt overrides, and how invalid values are handled.
- [Hosts and runtime behavior](./docs/hosts.md) — terminal vs RPC vs non-interactive, what degrades in each, and the load-failure envelopes.
- [Localization](./docs/localization.md) — the nine shipped languages, how the locale is chosen, and how to add one.

## Event contract

The extension emits `rpiv:ask-user:prompt`, `rpiv:ask-user:blocked`, and
`rpiv:ask-user:answer-result`, and listens on `rpiv:ask-user:answer`, so an external driver
can answer or cancel a questionnaire without synthesizing keystrokes. Channel names keep
their historical `rpiv:` prefix so listeners written for the upstream contract keep
working. See [docs/tool-schema.md](./docs/tool-schema.md#event-contract).

## Requirements

- Node.js 22 or newer.
- Pi Agent, with an interactive terminal or an RPC/ACP host. Non-interactive runs never see the tool.
- A terminal at least 100 columns wide for side-by-side previews; narrower terminals stack the preview under the options.

No native dependencies, no compiler, no API keys — the extension makes no model calls of its own.

## Troubleshooting

**The model says the questionnaire UI failed to load and asks its questions as chat text.** The dialog's modules were replaced on disk while Pi was running, usually by a package-manager install touching the store. Repair the install if it is broken, then restart Pi; the failure is not recoverable inside the running process.

**`Ctrl+]` does nothing.** On keyboard layouts where `]` sits on the shifted layer (Latin American among them) the default is unreachable. Set `collapseKey` to something you can type, for example `"alt+o"`.

**The dialog is in the wrong language.** It follows `LANG` and friends; override it with `PI_LANG=zh_CN.UTF-8` (or any shipped code) and restart Pi.

## Upstream

The code is a port of the MIT-licensed `@juicesharp/rpiv-ask-user-question` package. The two
adaptations are:

- `rpiv-config` (config file I/O and guidance validation) is inlined in [config.ts](./config.ts).
- `rpiv-i18n` (the `/languages` SDK) is replaced by the built-in locale loader in
  [state/i18n-bridge.ts](./state/i18n-bridge.ts).

Event channel names, config key names, and the tool schema are unchanged.

## License

MIT — see [LICENSE](./LICENSE). The upstream copyright notice is retained.
