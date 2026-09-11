# Fix Plan

Derived from two independent reviews of the provider, cross-verified against the
code on 2026-09-12. Every claim below was checked; line numbers are accurate as
of `e6fc233` and will drift as phases land — re-grep rather than trusting them
after the first commit.

Read `AGENTS.md` first. Several things in here look like cleanups but are
load-bearing, and that file says which.

Phases are ordered by user-visible impact. Each is a single commit. Phase 1
items share a design decision, so do them together.

---

## Phase 1 — Wrong behavior a user will actually hit

### 1.1 Make `resolveApiKey` report its source

Prerequisite for 1.2 and 1.3. The 401 handler cannot be correct while it has no
idea which key authenticated the request.

`src/provider/index.ts:88-92`

```ts
type ResolvedKey = {key: string; source: 'configuration' | 'secret'};

async resolveApiKey(): Promise<ResolvedKey | undefined> {
  if (this.configuredApiKey) {
    return {key: this.configuredApiKey, source: 'configuration'};
  }
  const stored = await this.authManager.getApiKey();
  return stored ? {key: stored, source: 'secret'} : undefined;
}
```

Thread the resolved source down to `throwMappedError`. The quota poller in
`extension.ts:299` only wants `.key`.

### 1.2 Fix 401 handling

`src/provider/index.ts:327-333`

Today `deleteApiKey()` runs unconditionally, regardless of which key failed.

Failure mode: picker-configured key is stale, secret storage holds a good key.
A 401 deletes the **good** key, leaves the bad one in `configuredApiKey`, and
tells the user to run "GLM: Set API Key" — which cannot help, because
`resolveApiKey()` prefers `configuredApiKey`. The user is now stuck in a loop
that also destroyed a working credential.

Fix:

- `source === 'secret'` → `await this.authManager.deleteApiKey()`
- `source === 'configuration'` → `this.configuredApiKey = undefined`
- either way → `this.fireLanguageModelChatInformationChange()`, or the picker
  keeps offering models backed by a key known to be dead
- make the message name the right remedy for the source that actually failed

Also clear `configuredApiKey` on both early returns in
`provideLanguageModelChatInformation` (`:103-105`, `:111-113`) — removing or
blanking the key in the picker currently leaves the old one cached and in use by
the quota poller.

### 1.3 Stop turning cancellation into an error

`src/api.ts:282-283`, `src/provider/index.ts:146-153`

Verified: `APIUserAbortError extends APIError<undefined, undefined, undefined>`
(`node_modules/openai/core/error.d.ts:19`), so `toGlmApiError` swallows it into
`GlmApiError` with `status ?? 0`. The user sees the literal string:

```
GLM API error: undefined Request was aborted.
```

The `isCancellationRequested` guards (`api.ts:265`, `index.ts:233`) never fire —
the pending `next()` rejects, so the loop head does not re-execute.

Fix in `provideLanguageModelChatResponse`'s catch: if `token.isCancellationRequested`,
return cleanly or throw `vscode.CancellationError` instead of calling
`throwMappedError`. Optionally detect `APIUserAbortError` in `toGlmApiError` and
carry a flag, but the token check is sufficient and doesn't couple `api.ts` to
cancellation semantics.

### 1.4 Collapse the two auth paths

`src/provider/index.ts:119-126`, `:135-139`, plus the `ModelWithApiKey` type at
`:22-25`

`__glmApiKey` is smuggled through `LanguageModelChatInformation` via
`as unknown as`, betting that VS Code round-trips unknown properties on those
objects — not part of the API contract. It is redundant: `configuredApiKey`
already holds the identical value from the identical source.

Replace `:135-139` with `await this.resolveApiKey()`, then delete
`modelsWithApiKey`, `ModelWithApiKey`, and both casts.

**This is a real behavior change, not a pure refactor.** `getOrPromptApiKey()`
prompts; `resolveApiKey()` does not. That prompt is unreachable today — models
only reach the picker when `options.configuration.apiKey` is set (`:103-113`), so
a request can never arrive without a key — but say so in the commit message
rather than claiming equivalence.

**Verification:** all four items are behavioral and untested by the compiler.
Exercise by hand in a clean profile: valid key, stale key, key removed
mid-session, Stop pressed mid-stream.

Add one scenario explicitly, because 1.2's clear-on-early-return rests on an
untested assumption — that a configuration-absent call always means "not
configured", never a silent probe made while a configured key still exists.
Stable 1.116 declares `silent: boolean` for exactly that kind of resolution
attempt. If such a probe can arrive with `configuration` absent, clearing the
cached key there would be a regression, not a fix. Confirm what VS Code actually
sends before shipping 1.2 (the 2.1 log-the-whole-options diagnostic answers this
directly — land it first).

---

## Phase 2 — Silent failures

### 2.1 The `configuration` field is real API on a churning interface

**This section previously had the story backwards and recommended a deprecated
property. Corrected.**

`src/provider/index.ts:28-35`, `:103-113`

What's true: `configuration` is **real VS Code API**, not an invention. The
proposed d.ts declares it, with a doc comment matching the code's usage exactly:

```ts
// vscode.proposed.chatProvider.d.ts
export interface PrepareLanguageModelChatModelOptions {
    /**
     * Configuration for the model. This is only present if the provider has
     * declared that it requires configuration via the `configuration` property.
     */
    readonly configuration?: { readonly [key: string]: any };
}
```

And the contribution-points reference calls `configuration` (with `"secret": true`)
"the recommended way to let users configure a provider". So the current wiring is
the *current* pattern, correctly applied.

**Do not declare `managementCommand`.** An earlier draft recommended it. The
contribution-points reference marks it *"Deprecated. Use `configuration`
instead."* Adding it would move the extension backwards.

What genuinely survives is a **compile-time** risk, and it's sharper than
"typings lag" — the interface is actively churning in *both* directions:

| Source | Shape |
|---|---|
| stable `@types/vscode` 1.116 & 1.137 | `{ silent: boolean }` — no `configuration` |
| `vscode.proposed.chatProvider.d.ts` (main) | `{ configuration?: {...} }` — **no `silent`** |

The local `PrepareLanguageModelChatInfoOptions` augmentation papers over that
gap. A future `@types/vscode` sync could break the build, or worse, silently
type-narrow and change which branch runs.

Fix:

- When `options.configuration` is absent or carries no `apiKey`, log the whole
  `options` object to the output channel before returning `[]` — don't log
  named fields, since which fields exist is exactly what's in flux.
- Keep the experiment: if a secret-storage key exists but no configuration
  arrived, consider listing models anyway rather than returning `[]`. That is
  what would make the README's quick-start true, resolving 2.2 one way. Verify
  in a clean profile before committing to it.
- Revisit whenever `@types/vscode` moves (see AGENTS.md — the floor is pinned,
  so this won't move on its own).

### 2.2 Fix the README quick-start

`README.md:57-58`

Says: run `GLM: Set API Key`, then select the provider. Given the gate at
`:103-113`, the secret-storage flow alone surfaces no models — the user must also
enter the key through VS Code's model-configuration UI.

Either fix the docs to describe the real flow, or change the gating per 2.1 so
the documented flow works. Decide after testing in a clean profile; don't guess.

### 2.3 Tool-result fidelity

`src/provider/convert.ts:36`, `:65-75`, `:101-107`

Three silent data drops:

1. `convertMessages` is a strict 1:1 `.map`, and `MessageAccumulator` holds a
   single `toolResult` slot that each part overwrites — only the **last**
   `LanguageModelToolResultPart` in a message survives.
2. Text co-existing with a tool result is discarded by the early return at `:101`.
3. Non-text result content maps to `''` — images from Flash vanish.

**Priority corrected — the original premise was refuted.** An earlier draft of
this plan claimed VS Code batches parallel tool results into one message. That
is wrong. Copilot Chat's `toolCalling.tsx` gives each parallel tool call its own
`ToolResultElement`, each rendering its own `<ToolMessage toolCallId={...}>` —
one message per result, never batched. So #1 **does not break Copilot agent mode
today**.

It remains a real hole: the batched layout is legal per the type contract
(`content: ReadonlyArray<LanguageModelInputPart | unknown>`), and VS Code's own
LM wrapper validator accepts one user message carrying several tool-result
parts — so any extension calling `vscode.lm.sendRequest` directly can produce
it, and we would silently drop data with no error.

Fix it as cheap hardening, not as a P1. #2 and #3 are unconditional bugs
regardless.

Fix: `convertMessages` becomes `flatMap`, accumulator holds
`toolResults: ToolResult[]`, each emits its own `{role:'tool', tool_call_id}`
message in order. Preserve text alongside. Map non-text result content to
something better than `''`.

### 2.4 Timeout the quota fetch

`src/quota.ts:129`

Bare `fetch`, no `AbortSignal`. `quotaRefreshInFlight` clears only in `finally`,
so a hung connection blocks every subsequent poll with no user-visible signal.

**Severity corrected:** an earlier draft said "for the rest of the session".
undici's defaults (10s connect, 300s headers/body) bound most hangs at ~5
minutes, so the session-long stall needs a drip-feeding server or repeated
hangs. Still worth fixing — a 5-minute silent stall on a 5-minute poll interval
means the status bar goes stale with no explanation.

`AbortSignal.timeout(10_000)` plus a distinguishable message on timeout. Safe on
the `node20` bundle target.

### 2.5 `provideTokenCount` ignores non-text content

`src/provider/index.ts:344-362`

Counts only `LanguageModelTextPart`. Images (`LanguageModelDataPart`), tool calls
and tool results all count as **zero**. VS Code uses this for context budgeting,
so Flash with image input under-counts badly and lets requests through that the
server then rejects.

`chars/4` is fine for text; the gap is the parts that count as nothing. Add
tool-call arguments and tool-result content, and a flat per-image estimate.

Raised in one review only, and severity is unverified — VS Code may not lean on
this heavily. Worth doing, but measure before treating it as urgent.

---

## Phase 3 — Duplication and hygiene

### 3.1 One temperature table

`src/models.ts:6-11` (values), `src/models.ts:33-48` (schema enum +
descriptions), `src/extension.ts:109-134` (QuickPick)

Three definitions of the same four presets. Already drifted into contradiction:
the schema calls max *"Recommended by Z.AI (1.0)"*, the QuickPick calls it
*"Maximum (most random)"* — opposite advice about one value.

Derive the QuickPick items and schema descriptions from a single table beside
`TEMPERATURE_PRESET_VALUES`, holding value + label + description. Drop the unused
`key` field at `extension.ts:111`.

### 3.2 Small cleanups

| Item | Location | Change |
|---|---|---|
| Browser-style base64 | `convert.ts:141-149` | `Buffer.from(data).toString('base64')` — this is always a Node host; drops a full copy and a pass per image |
| Unreachable `throw error` | `index.ts:341` | Restructure so control flow doesn't need the pacifier; a `switch` says it plainly |
| Removable cast | `api.ts:274-276` | `prompt_tokens_details` is properly typed in 6.34 (noted in AGENTS.md) |
| `chat()` is a ping | `api.ts:289-301` | Returns `Promise<void>`, discards the completion, never fires `onUsage`. Only caller is `testConnection`. Rename to `ping()`/`validateKey()` |
| Unit enum duplicated | `quota.ts:6`, `:78` | One table with both minutes and display name |
| TDZ ordering | `extension.ts:296` vs `:376` | `refreshPlanQuota` closes over `provider`; safe only because the first call sits at `:391`. Declare `provider` before the quota machinery |
**Delete `resolveThinking`'s `'enabled'`/`'disabled'` branches** (`index.ts:165`),
along with the "legacy" comment above them.

Earlier drafts went back and forth on whether these were reachable, on the
assumption that users carried values forward from 0.7.x. They don't — this
extension is new. `phucnguyennhu.glm-models-provider` first appears at `5caee52`
as v0.8.0, and the picker schema there already had zero `'enabled'` occurrences;
the old vocabulary only ever shipped under `DenizhanDaklr.glm-chat-provider`,
a different extension with its own settings and its own users.

So no user of *this* extension has ever been offered those values, by either
path. Deletion is also safe on its own terms: `effortFor`'s `default: return {}`
(`index.ts:181-182`) sends no thinking params at all, so any unexpected value
degrades to the API default rather than misbehaving.

---

## Phase 4 — Tests

No test script exists. `pretest`/`posttest` in `package.json` are inert — npm
only runs pre/post hooks around a script that exists.

Add vitest. The riskiest code is also the most testable, and none of it needs a
running VS Code except `toGlmMessage`.

Stubbing `vscode` for that one is more than `instanceof` stand-ins: `mapRole`
reads the `LanguageModelChatMessageRole` **enum constants**, so the stub needs
those values too, and `convert.ts` also touches `LanguageModelTextPart`,
`ToolCallPart`, `ToolResultPart` and `DataPart`. Budget a real module mock
(`vi.mock('vscode', ...)`) rather than a two-line shim.

- `parsePlanQuota` — quirky third-party payload: unit enums, four `planName`
  fallbacks, percentage clamping, missing-window diagnostics. Record real Z.AI
  responses as fixtures.
- `toGlmMessage` / `convertMessages` — the Phase 2.3 cases: multiple tool
  results, text beside a tool result, non-text result content, images.
- `normalizeTemperatureValue` — presets, `'custom'`, out-of-range clamping,
  garbage strings.
- `parseToolArguments` — malformed and hostile JSON.

Wire a real `test` script so the existing hooks stop being decorative.

---

## Phase 5 — Deferred: split `extension.ts`

438 lines holding command handlers, usage accounting, quota polling and
throttling, formatting, status-bar rendering, and activation wiring, with all
state as loose closures inside a ~200-line `activate()`. That closure soup is why
3.2's TDZ trap exists.

Suggested split: `src/usage.ts` (totals + `formatTokenCount`), `src/statusBar.ts`
(the item, `formatCountdown`, `describePlanWindow`, poll throttle),
`src/commands.ts` (the five handlers), leaving `extension.ts` as wiring.

Deferred deliberately: it touches every line Phases 1–2 modify. Do it after, or
the diffs become unreviewable.

---

## Explicitly not doing

Per `AGENTS.md` — do not let a cleanup pass undo these:

- **Don't raise `engines.vscode`.** Floor, not target. The entire API diff
  1.116 → 1.137 is one reordered enum member.
- **Don't bump `openai`.** v7 was evaluated and rejected on bundle size
  (138,659 → 300,711 bytes) for zero features used. The pin is deliberate.
- **Don't remove the `reasoning_effort` cast** (`api.ts`). GLM's `'max'` is not
  in OpenAI's `ReasoningEffort` union. Load-bearing.
- **Don't remove the thinking-part shim** (`provider/thinking.ts`).
  `LanguageModelThinkingPart` is still absent from stable typings at 1.137.

## Gate for every phase

```sh
npx tsc --noEmit && npx gts lint && node bundle.mjs
```

Phase 1 and 2.1–2.3 are not covered by those gates. Test by hand in a clean
profile until Phase 4 lands.
