import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Key spec for the overlay collapse/expand shortcut, e.g. `"ctrl+]"` or `"alt+o"`. */
export type CollapseKeySpec = string;

export const DEFAULT_COLLAPSE_KEY: CollapseKeySpec = "ctrl+]";
export const COLLAPSE_KEY_OFF: CollapseKeySpec = "off";
export const DEFAULT_NOTES_KEY = "n";

/** Package directory name under `~/.config` — also the identity used in messages. */
const CONFIG_DIR_NAME = "ask-user-question";

/** Pre-port config directory, read as a fallback so existing settings keep working. */
const LEGACY_CONFIG_DIR_NAME = "rpiv-ask-user-question";

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
	description?: string;
}

export interface AskUserQuestionConfig {
	guidance?: GuidanceFields;
	/**
	 * Key spec for the collapse/expand shortcut, in the same format as pi-coding-agent
	 * keybinding ids (`modifier+key`, e.g. `ctrl+]`, `alt+o`, `ctrl+shift+h`). Defaults
	 * to `"ctrl+]"`. Set this to a key that is reachable on your keyboard layout — Latin
	 * American layouts (where `]` is on the shifted layer) often want `"ctrl+}"` instead.
	 * Pass `"off"` to disable the collapse shortcut entirely.
	 */
	collapseKey?: CollapseKeySpec;
	/**
	 * Key that opens the notes editor. Defaults to `"n"`. A single character of any
	 * script (e.g. `"т"` on a Cyrillic layout) matches as typed; anything else is a
	 * key spec in the `collapseKey` format, e.g. `"ctrl+n"`.
	 */
	notesKey?: string;
}

// =============================================================================
// Config I/O — trimmed, dependency-free copy of the rpiv-config helpers this
// extension uses. Kept local so the plugin ships with no runtime dependency
// beyond what Pi itself provides.
// =============================================================================

/** `XDG_CONFIG_HOME` when it is absolute, otherwise `~/.config`. */
function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME?.trim();
	if (!xdg) return join(homedir(), ".config");
	if (xdg === "~") return homedir();
	const expanded = xdg.startsWith("~/") ? join(homedir(), xdg.slice(2)) : xdg;
	return isAbsolute(expanded) ? expanded : join(homedir(), ".config");
}

function configPathFor(name: string): string {
	return join(configDir(), name, "config.json");
}

/** Parse a JSON object file, returning `{}` for a missing, malformed, or non-object file. */
function readJsonObject<T>(path: string): T {
	if (!existsSync(path)) return {} as T;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
		return parsed as T;
	} catch (err) {
		console.warn(`ask-user-question: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`);
		return {} as T;
	}
}

/**
 * Read the config, preferring `<XDG_CONFIG_HOME>/ask-user-question/config.json`
 * and falling back to the pre-rename `~/.config/rpiv-ask-user-question/config.json`
 * only when the new path does not exist. A malformed new-path file warns and
 * resolves to `{}` rather than silently masking corruption with the old file.
 */
function loadJsonConfigWithLegacyFallback<T>(): T {
	const current = configPathFor(CONFIG_DIR_NAME);
	if (existsSync(current)) return readJsonObject<T>(current);
	return readJsonObject<T>(configPathFor(LEGACY_CONFIG_DIR_NAME));
}

/**
 * Validate and extract guidance fields from an unknown value.
 * Returns a clean `GuidanceFields` object with only valid entries.
 */
export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const g = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) {
		result.promptSnippet = g.promptSnippet;
	}
	if (
		Array.isArray(g.promptGuidelines) &&
		g.promptGuidelines.length > 0 &&
		g.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
	) {
		result.promptGuidelines = g.promptGuidelines;
	}
	if (typeof g.description === "string" && g.description.length > 0) {
		result.description = g.description;
	}
	return result;
}

// Named keys accepted by pi-tui's `matchesKey` (keys.js switch on the parsed base key).
// parseKeyId lowercases the id before matching, so lowercase spellings are canonical.
const SPECIAL_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

function isValidCollapseKeySpec(spec: string): boolean {
	// Mirror pi-tui's KeyId grammar strictly: zero or more distinct modifiers, then a
	// base key that is a single printable character or a named special key. A loose
	// check is not enough — pi-tui's `parseKeyId` takes the LAST `+`-part as the key
	// and ignores unknown parts, so a typo like `ctr+]` would silently match every
	// bare `]` keypress (and the raw terminal listener would consume them globally).
	if (!spec) return false;
	if (spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
	const parts = spec.split("+");
	const base = parts[parts.length - 1] ?? "";
	const modifiers = parts.slice(0, -1);
	if (modifiers.length !== new Set(modifiers).size) return false;
	if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
	return base.length === 1 ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base) : SPECIAL_KEYS.has(base);
}

export function resolveCollapseKey(config: Pick<AskUserQuestionConfig, "collapseKey">): CollapseKeySpec {
	const raw = config.collapseKey?.trim().toLowerCase();
	if (raw === undefined || raw === "") return DEFAULT_COLLAPSE_KEY;
	if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
	return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

// Keys the questionnaire already navigates with — a notes key on one of them would shadow it.
const NOTES_KEY_RESERVED = new Set(["space", "enter", "return", "tab", "escape", "esc", "up", "down", "left", "right"]);

export function resolveNotesKey(config: Pick<AskUserQuestionConfig, "notesKey">): string {
	const raw = config.notesKey?.trim();
	if (!raw) return DEFAULT_NOTES_KEY;
	if ([...raw].length === 1) return raw;
	const spec = raw.toLowerCase();
	return isValidCollapseKeySpec(spec) && !NOTES_KEY_RESERVED.has(spec) ? spec : DEFAULT_NOTES_KEY;
}

/** A single-character notes key shows as configured (`n`, not `N`); a spec is display-cased. */
export function formatNotesKeyForDisplay(notesKey: string): string {
	return [...notesKey].length === 1 ? notesKey : formatKeySpecForDisplay(notesKey);
}

// The only compound-word names in SPECIAL_KEYS — first-letter capitalization
// alone would render them "Pageup"/"Pagedown".
const COMPOUND_KEY_DISPLAY: Record<string, string> = {
	pageup: "PageUp",
	pagedown: "PageDown",
};

/**
 * Pretty-print a resolved key spec for UI copy: each `+`-part gets its first
 * character uppercased (`"ctrl+]"` → `"Ctrl+]"`, `"alt+o"` → `"Alt+O"`,
 * `"f9"` → `"F9"`, `"ctrl+pagedown"` → `"Ctrl+PageDown"`). Display-only — key
 * matching always uses the raw lowercase spec (`matchesKey` lowercases ids),
 * so never feed the result back into it.
 */
export function formatKeySpecForDisplay(spec: CollapseKeySpec): string {
	return spec
		.split("+")
		.map(
			(part) =>
				COMPOUND_KEY_DISPLAY[part] ??
				(part.length <= 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)),
		)
		.join("+");
}

export function loadConfig(): AskUserQuestionConfig {
	return loadJsonConfigWithLegacyFallback<AskUserQuestionConfig>();
}
