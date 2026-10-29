/**
 * ask-user-question — Pi extension. Registers the `ask_user_question` tool: a
 * structured option selector with an automatically appended `Type something.`
 * custom-answer row.
 *
 * Sentinel labels and TUI chrome strings localize at render time via the i18n
 * bridge (`state/i18n-bridge.ts`), which reads the flat dictionaries in
 * `locales/`. Locale resolution honors `PI_LANG`, then `LC_ALL`,
 * `LC_MESSAGES`, and `LANG`; untranslated keys fall back to the inline English
 * literal at the call site, so a partial translation never renders blank.
 *
 * Adding a locale: drop `locales/<code>.json` next to en.json mirroring its key
 * set. No edit needed here.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserQuestionTool } from "./ask-user-question.ts";
import { registerAskUserQuestionReconciler } from "./reconcile.ts";

export {
	ASK_USER_ANSWER_EVENT,
	ASK_USER_ANSWER_RESULT_EVENT,
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	type AskUserAnswerEntry,
	type AskUserAnswerEventPayload,
	type AskUserAnswerRejectCode,
	type AskUserAnswerResultEventPayload,
	type AskUserBlockedEventPayload,
	type AskUserPromptEventPayload,
	type AskUserPromptOption,
	type AskUserPromptQuestion,
} from "./events.ts";

export default function (pi: ExtensionAPI) {
	registerAskUserQuestionTool(pi);
	registerAskUserQuestionReconciler(pi);
}
