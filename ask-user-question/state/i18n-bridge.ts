/**
 * i18n bridge for ask-user-question — single thin import surface so every call
 * site routes through one place. Backed by the locale files shipped in
 * `../locales/`; falls back to the inline English literal at every call site
 * when no translation is found.
 *
 * - `t(key, fallback)` looks `key` up in the active locale's flat dictionary
 *   and returns `fallback` when the locale is English, the file is missing, or
 *   the key is untranslated. A partially translated file is therefore safe.
 * - `displayLabel(kind)` resolves a sentinel kind to its locale-aware label,
 *   with the canonical English `ROW_INTENT_META[kind].label` as fallback so
 *   nothing renders blank.
 *
 * Strings are read at render time — never bake the result into a top-level
 * `const X = displayLabel(...)`.
 *
 * Reserved-label validation stays English-locked: `RESERVED_LABEL_SET` checks
 * the canonical `ROW_INTENT_META[kind].label`, never `displayLabel(kind)`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROW_INTENT_META, type SentinelKind } from "./row-intent.ts";

type ScopeFn = (key: string, fallback: string) => string;
type Dictionary = Readonly<Record<string, unknown>>;

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");

/**
 * Locale candidates for one environment value, most specific first.
 *
 * Accepts POSIX (`de_DE.UTF-8`, `pt_BR`, `zh_CN.UTF-8@euro`) and BCP 47
 * (`pt-BR`) spellings. Region-specific files win over the base language:
 * `pt_BR` → `pt-BR`, then `pt`. `C`/`POSIX` mean "no locale", not a language.
 */
function localeCandidates(raw: string | undefined): string[] {
	const value = raw?.trim();
	if (!value) return [];
	const base = value.replace(/[.@].*$/, "").replace(/_/g, "-");
	if (!base || base === "C" || base === "POSIX") return [];
	const [language = "", region] = base.split("-");
	if (!language) return [];
	return region ? [`${language}-${region}`, language] : [language];
}

/**
 * Pick the active locale: `PI_LANG` first (an explicit, extension-scoped
 * override), then the usual POSIX precedence `LC_ALL` → `LC_MESSAGES` → `LANG`.
 */
function resolveLocale(): string[] {
	const env = process.env;
	return [
		...localeCandidates(env.PI_LANG),
		...localeCandidates(env.LC_ALL),
		...localeCandidates(env.LC_MESSAGES),
		...localeCandidates(env.LANG),
	];
}

function loadDictionary(): Dictionary {
	for (const code of resolveLocale()) {
		if (code === "en") break;
		try {
			const parsed = JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), "utf-8")) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Dictionary;
		} catch {
			// Missing or unreadable locale file — try the next candidate, then English.
		}
	}
	return {};
}

let dictionary: Dictionary | undefined;

export const t: ScopeFn = (key, fallback) => {
	dictionary ??= loadDictionary();
	const value = dictionary[key];
	return typeof value === "string" ? value : fallback;
};

export function displayLabel(kind: SentinelKind): string {
	return t(`sentinel.${kind}`, ROW_INTENT_META[kind].label);
}
