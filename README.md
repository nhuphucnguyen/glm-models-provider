# GLM Chat Provider

Z.AI GLM models as a VS Code Language Model Chat Provider for the Coding Plan.

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

## Thinking Mode

GLM-5.3 models always use reasoning/thinking -- it cannot be disabled. You can control the reasoning depth with `reasoning_effort`.

Run `GLM: Set Thinking Effort` from the Command Palette to choose between:

- **Auto** -- Use the API default effort level (max)
- **Low** -- Lightweight reasoning, faster responses
- **High** -- Enhanced reasoning
- **Max** -- Deep reasoning, best for complex tasks (API default)

The selected value is persisted in your VS Code settings under `glm-chat-provider.defaultThinkingMode`.

## How to Use

1. Open the Command Palette and run `GLM: Set API Key` to configure your API credentials
2. Use the provider from VS Code's Language Model Chat UI and select **Z.AI GLM**

---

## License

MIT (c) Denizhan Dakilir
