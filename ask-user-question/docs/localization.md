# Localization

How the dialog picks its language, which languages ship, and how to add one.

## How it works

The extension ships its own string catalog in `locales/` — no extra package to install.
Every user-facing chrome string is looked up in the active locale's flat dictionary at
render time, with the inline English literal at the call site as the fallback. A key that
a translation does not cover renders in English, never blank.

The language is resolved once, when the extension loads, first hit wins:

1. `PI_LANG` — an extension-scoped override (e.g. `PI_LANG=zh_CN.UTF-8`).
2. `LC_ALL`
3. `LC_MESSAGES`
4. `LANG`
5. English

Both POSIX (`de_DE.UTF-8`, `pt_BR`) and BCP 47 (`pt-BR`) spellings are accepted. A
region-specific file wins over the base language: `pt_BR` tries `pt-BR.json`, then
`pt.json`. `C` and `POSIX` mean "no locale" and resolve to English.

Changing the language needs a Pi restart: the dictionary is loaded with the module.

## Shipped languages

Nine locale files ship in `locales/`:

| Code | Language |
| --- | --- |
| `de` | Deutsch |
| `en` | English |
| `es` | Español |
| `fr` | Français |
| `pt` | Português |
| `pt-BR` | Português (Brasil) |
| `ru` | Русский |
| `uk` | Українська |
| `zh` | 中文 |

## What is translated, and what is not

Translation covers the chrome you read: the `Type something.` and `Next` sentinel rows,
the footer hint segments (including the collapsed-state line and the Submit tab's
`n to add a note` hint), the Submit picker labels, the review-tab heading with its
submit-readiness prompt, incomplete-answers warning, and committed-note `Note` label, the
preview pane's empty and notes-affordance lines, the notes header and the global-note
header on the Submit tab, the external-editor failure notification, the two RPC dialog
prompts, and the transcript's no-answer lines.

Everything the *model* reads stays English by design: the tool description, the parameter
schema descriptions, error messages, and the reserved-label list. Those are prompt inputs,
not UI, and translating them would change model behavior rather than your reading
experience. It also means reserved-label validation compares against fixed English
strings, so `Type something.` is rejected as an authored option label in every locale.

## Adding a language

No code change is required.

1. Copy `locales/en.json` to `locales/<code>.json`, where `<code>` is a lowercase language
   tag (`it`) or `language-REGION` tag (`pt-BR`).
2. Translate the values. Keep every key, and keep the placeholders and leading symbols
   (`↑/↓`, `⚠`) intact. `hint.collapse`, `hint.expand_line`, `hint.notes`,
   `review.global_hint`, and the two `preview.notes*` keys contain a literal `{key}`
   placeholder that is replaced at render time with the user's configured key — keep it
   verbatim, positioned wherever your language's word order wants the key name.
3. Restart Pi.

Untranslated keys fall back to English, so a partial file is safe.
