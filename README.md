# GLM Models Provider

Z.AI GLM models as a VS Code Language Model Chat Provider for the Coding Plan.

> **Maintained fork** — the original extension by [DenizhanDaklr](https://github.com/zelosleone/glm-chat-provider) is no longer maintained. This fork continues development with support for the latest GLM-5.3 models.

## Why only GLM-5.3 and GLM-5.3-Flash?

Z.AI has moved the GLM Coding Plan to GLM-5.3 and GLM-5.3-Flash. Per the [official plan overview](https://docs.z.ai/devpack/overview#supported-models), requests for GLM-5.2/GLM-5.1 are **automatically routed to GLM-5.3**, and requests for GLM-4.7 are routed to GLM-5.3-Flash -- the legacy models no longer exist as distinct options. Keeping them in the picker would only add clutter:

- **GLM-5.3** is the current flagship -- same price as GLM-5.2, with significantly stronger coding and long-horizon performance, plus a full 1M-token context.
- **GLM-5.3-Flash** outperforms GLM-5.2 while costing roughly 20x less, and it is natively multimodal (image input).

### Text Models

| Model | Context | Output | Tool Calling |
|---|---|---|---|
| GLM-5.3 | 1M | 128K | Yes |

### Vision Models

| Model | Context | Output | Image Input | Tool Calling |
|---|---|---|---|---|
| GLM-5.3-Flash | 1M | 128K | Yes | Yes |

## Commands

- `GLM: Set API Key` -- Store your Z.AI API key in VS Code secrets
- `GLM: Clear API Key` -- Remove the stored API key
- `GLM: Manage Provider` -- Open provider management options
- `GLM: Set Thinking Effort` -- Choose reasoning effort (Auto, Low, High, Max)
- `GLM: Set Temperature` -- Choose a temperature preset or enter a custom value (0.0 - 1.0)

## Thinking Mode

GLM-5.3 models always use reasoning/thinking -- it cannot be disabled. You can control the reasoning depth with `reasoning_effort`.

Run `GLM: Set Thinking Effort` from the Command Palette to choose between:

- **Auto** -- Use the API default effort level (max)
- **Low** -- Lightweight reasoning, faster responses
- **High** -- Enhanced reasoning
- **Max** -- Deep reasoning, best for complex tasks (API default)

The selected value is persisted in your VS Code settings under `glm-models-provider.defaultThinkingMode`.

## Sampling Defaults

Per the [official GLM-5.3 docs](https://docs.z.ai/guides/llm/glm-5.3), Z.AI recommends `temperature: 1.0` and `top_p: 0.95` for GLM-5.3 models, so the extension applies them by default:

- The model picker's temperature setting defaults to **Max (1.0)**. You can still pick a preset or custom value per model, or run `GLM: Set Temperature`.
- Every request sends `top_p: 0.95` (configurable via `glm-models-provider.topP`).
- When a request streams with tools, `tool_stream: true` is sent alongside `stream: true`.

## How to Use

1. Open the model picker in VS Code's Chat view and choose **Manage Models…**
2. Select **Z.AI GLM** and enter your API key when prompted
3. Pick **GLM-5.3** or **GLM-5.3 Flash** from the model picker

Step 1 is what makes the models appear. VS Code passes the key it collects there
to the provider, and the provider lists no models until it arrives.

`GLM: Set API Key` stores a key in the extension's own secret storage instead.
That copy backs **Test Connection** and plan-quota polling when no key has been
entered through the picker — it does not, on its own, put models in the picker.

---

## License

MIT (c) Denizhan Dakilir
