# AGENTS.md

Notes for agents working on this repo. The dependency situation here has a few
non-obvious constraints where the usual "keep everything current" instinct
produces a worse extension. Read the dependency section before bumping anything.

## What this is

A VS Code extension that registers Z.AI's GLM models as a
`LanguageModelChatProvider` under the vendor id `zai`, so GLM appears in the
native model picker and bills against a Z.AI Coding Plan. It talks to
`https://api.z.ai/api/coding/paas/v4` through the OpenAI SDK, because Z.AI is
OpenAI-compatible.

| Path | Role |
|---|---|
| `src/extension.ts` | Activation, commands, status bar, usage + quota display |
| `src/provider/index.ts` | Provider: model list, stream loop, tool-call assembly, error mapping |
| `src/provider/convert.ts` | VS Code message/tool parts ↔ GLM wire format |
| `src/api.ts` | OpenAI-client wrapper, request params, error normalization |
| `src/quota.ts` | Z.AI Coding Plan quota polling |
| `src/models.ts` | Model definitions + model-picker config schema |

Build is esbuild (`bundle.mjs`) → `out/extension.js`, target `node20`, `vscode`
external.

`npm test` runs compile → vitest → lint. Tests alias the `vscode` module to
`test/vscode-stub.ts`, since the real one exists only inside the extension host;
the stub's `LanguageModelChatMessageRole` values must match the real enum,
because `mapRole` compares against them. Tests are covered by
`tsconfig.test.json`, a lint-only project — the build `tsconfig.json` emits from
`src` alone.

Anything reachable without the extension host (message conversion, quota
parsing, temperature normalization) should get a test. The provider, status bar
and commands need a running VS Code and are still verified by hand.

## Dependencies: policy and the reasoning behind it

Findings below were verified 2026-09-12. Re-verify before acting on them —
the commands are given so you can.

### `engines.vscode` is a floor, not a target

`engines.vscode: ^1.116.0` means **minimum 1.116**. Raising it gains nothing by
itself; it only buys the right to call newer stable API, and it costs you every
user below the new floor. "Users keep VS Code updated" is an argument that a low
floor is *cheap to keep*, not an argument to raise it.

Only raise the floor when you can name the specific stable API you need.

As of 1.137 there is no such API. The full type diff across 21 releases:

```
@types/vscode 1.116.0 → 1.137.0  (2026-04-15 → 2026-09-09)
21 changed lines in 21,238 — and the only real API surface change is
CompletionItemKind.Reference = 17 being reordered in the declaration.
```

Everything else was doc comments, a JSDoc param rename, and one new text
encoding (`cp857`). Nothing under `LanguageModel*` changed at all.

**Keep `@types/vscode` pinned to exactly the `engines.vscode` floor** (both are
`1.116.0` today). That pin is what stops you compiling against API your declared
minimum doesn't ship. If you raise one, raise both, together.

**Version distance is not time distance.** VS Code moved from monthly to roughly
weekly releases during 2026 — 1.110 (2026-03-04) to 1.137 (2026-09-09) is 27
version numbers in six months. Being "20 versions behind" can mean five months.
Always check release dates before concluding a floor is stale.

**How low the floor could go**, if reach ever matters more than it does now:

| `@types/vscode` | Released | `tsc --noEmit` |
|---|---|---|
| 1.104.0 | 2025-09-11 | ✗ `LanguageModelDataPart` missing (breaks image input) |
| 1.106.0 | 2025-11-12 | ✓ clean |
| 1.110.0 | 2026-03-04 | ✓ clean |

So ~1.106 is the true compile floor. See the interaction with Node below before
actually lowering it.

### `openai` is pinned exactly — deliberately

`"openai": "6.34.0"`, no caret. This is not an oversight.

The SDK keeps adding resource namespaces (Agents API, Live API, realtime, audio)
that the `OpenAI` client imports eagerly, so esbuild cannot tree-shake them. The
bundle grows fast for features this extension will never call. Same source,
three versions:

| openai | Bundle | vs pinned |
|---|---|---|
| 6.34.0 (pinned) | 138,659 B | — |
| 6.49.0 (latest 6.x) | 180,796 B | +30% |
| 7.15.0 (latest) | 300,711 B | +117% |

With a caret, a build without the lockfile — CI, fresh clone — would silently
ship the larger bundle. The exact pin makes the size you tested the size you
ship.

This extension uses about five SDK surfaces: the constructor, `chat.completions.create`
streaming and non-streaming, `OpenAI.APIError`, and a handful of types. Weigh any
bump against that.

**openai v7 was evaluated and rejected**, not overlooked. Its only breaking
change is `engines.node >= 22`; it compiles clean against this source with zero
edits and `npm audit` is clean both before and after. It was rejected purely on
the 162KB for zero features used. If a future version carries something this
extension actually needs, the upgrade itself is safe.

### Check `engines.node` against VS Code's bundled Node, not your machine's

Extensions run in VS Code's Electron Node, which is usually *older* than a
developer's local Node. A dependency's `engines.node` must be satisfied by the
oldest VS Code you support.

| VS Code | Electron | Node |
|---|---|---|
| 1.110.0 | 39.6.0 | 22.22.0 |
| 1.112.0 | 39.8.0 | 22.22.0 — first release with Node 22 |
| 1.116.0 | 39.8.7 | 22.22.1 — current floor |
| 1.137.0 | 42.10.0 | 24.18.1 |

Check the real value rather than guessing:

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
  -e "console.log(process.versions.node, process.versions.electron)"
```

Reference for other versions: https://github.com/ewanharris/vscode-versions

**These two knobs interact.** Node 22 arrived in VS Code 1.112. Lowering
`engines.vscode` below 1.112 would put the floor on Node 20 and make openai v7
(and anything else requiring Node ≥22) permanently unavailable. Decide the
floor and the SDK major together.

### Evaluating a bump

Don't upgrade in place to find out. Build a scratch copy and compare:

```sh
SC=$(mktemp -d) && cd "$SC"
cp -R /path/to/repo/src package.json tsconfig.json bundle.mjs .
npm install && npm install openai@<new> @types/vscode@<new>
npx tsc --noEmit                        # does it still compile, unchanged?
node bundle.mjs && ls -l out/extension.js   # what did it cost?
npm audit --omit=dev                    # is there a security driver?
```

A bump needs an actual reason: a security fix, or an API this extension uses.
"It's newer" is not one — here it reliably means a bigger bundle or a smaller
audience.

## GLM/Z.AI specifics that look like bugs but aren't

Do not "clean these up" without reading why they exist.

- **`reasoning_effort` is cast through `Record<string, unknown>`** (`src/api.ts`).
  Necessary: OpenAI types it as
  `'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null`, and GLM's
  `'max'` is not in that union. The cast is load-bearing.
  (By contrast `prompt_tokens_details.cached_tokens` *is* properly typed in
  6.34 — that one cast could go.)
- **`thinking`/`tool_stream` are also cast through.** They are Z.AI extensions
  with no OpenAI equivalent. Same reason.
- **`LanguageModelThinkingPart` is still proposed API** — zero occurrences in
  stable `@types/vscode` as of 1.137. The runtime feature-detection shim in
  `src/provider/thinking.ts` is required, not legacy. Re-check before removing.
- **GLM-5.3 always reasons.** Thinking cannot be disabled; only the effort level
  varies. A `disabled` selection maps to `reasoning_effort: 'low'`, not to
  thinking off (`resolveThinking` in `src/provider/index.ts`).
- **`configuration` on `PrepareLanguageModelChatModelOptions` is real API, and
  the interface is churning.** Stable `@types/vscode` (1.116 and 1.137) declares
  `{silent}` only; `vscode.proposed.chatProvider.d.ts` declares `{configuration}`
  and has dropped `silent`. `src/provider/index.ts` augments the type locally to
  bridge that. Expect a future typings sync to need attention here — and do not
  "fix" it by declaring `managementCommand`, which the contribution-points
  reference marks deprecated in favour of `configuration`.
- **This extension has no legacy users — don't write migration code.** The git
  history predates the fork: commits before `5caee52` belong to
  `DenizhanDaklr.glm-chat-provider`, a *different* extension id with different
  setting keys (`glm-chat-provider.*`) and its own secret storage.
  `phucnguyennhu.glm-models-provider` starts at v0.8.0. Archaeology in this repo
  will keep turning up "orphaned settings" and "unreachable legacy branches";
  they belong to the upstream extension, not to ours. Nothing here needs a
  compatibility path.
- **API keys are validated as plain ASCII** (`src/api.ts`) because a smart quote
  or non-breaking space from a console copy-paste otherwise fails deep inside
  header encoding with an unhelpful error.
- **Only GLM-5.3 and GLM-5.3-Flash are listed, on purpose.** Z.AI auto-routes
  legacy model ids to these two, so listing more would be picker clutter. See
  README.
- **The base URL is the Coding Plan endpoint** (`/api/coding/paas/v4`), not the
  general Z.AI API path. Quota polling uses `/api/monitor/usage/quota/limit`,
  whose `unit` enum is `1=day, 3=hour, 5=minute, 6=week` (`src/quota.ts`).

## Before committing

```sh
npm test && node bundle.mjs
```

`npm test` already covers compile and lint. Add `node bundle.mjs` because the
bundle is what ships, and because bundle size is a standing constraint (see the
dependency section).

`*.vsix` and `out/` are gitignored; don't add them.
