import * as vscode from 'vscode';
import {GlmApiClient, GlmApiError} from '../api';
import type {ChatCompletionChunk} from 'openai/resources/chat/completions/completions';
import type {AuthManager} from '../auth';
import {
  GLM_MODEL_DEFINITIONS,
  getModelConfigurationSchema,
  type GlmModelDefinition,
  type ModelConfigurationOptions,
  type ModelPickerChatInformation,
} from '../models';
export {GLM_MODEL_DEFINITIONS};
import {createThinkingPart} from './thinking';
import {
  convertMessages,
  convertTools,
  parseToolArguments,
  type ToolCallBuilder,
} from './convert';
import {getConfiguredTemperature, getConfiguredTopP} from './temperature';

/** Where a resolved API key came from, so a 401 can invalidate the right one. */
export type ApiKeySource = 'configuration' | 'secret';

export interface ResolvedApiKey {
  key: string;
  source: ApiKeySource;
}

type PrepareLanguageModelChatInfoOptions =
  vscode.PrepareLanguageModelChatModelOptions & {
    readonly configuration?: {
      readonly apiKey?: string;
      readonly [key: string]: unknown;
    };
  };

function toChatInfo(m: GlmModelDefinition): ModelPickerChatInformation {
  return {
    id: m.id,
    name: m.name,
    family: m.family,
    version: m.version,
    detail: m.detail,
    tooltip: 'Z.AI',
    maxInputTokens: m.maxInputTokens,
    maxOutputTokens: m.maxOutputTokens,
    isUserSelectable: true,
    capabilities: {
      toolCalling: m.capabilities.toolCalling,
      imageInput: m.capabilities.imageInput,
    },
    ...(m.capabilities.thinking
      ? {configurationSchema: getModelConfigurationSchema()}
      : {}),
  };
}

const TYPED_MODELS: ModelPickerChatInformation[] = GLM_MODEL_DEFINITIONS.map(
  m => toChatInfo(m),
);

export type UsageCallback = (
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
  },
  modelId?: string,
) => void;

export class GlmChatProvider implements vscode.LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation =
    new vscode.EventEmitter<void>();

  readonly onDidChangeLanguageModelChatInformation =
    this._onDidChangeLanguageModelChatInformation.event;

  /** Latest API key supplied by VS Code's model configuration, when present. */
  private configuredApiKey?: string;

  constructor(
    private readonly authManager: AuthManager,
    private readonly onUsage?: UsageCallback,
  ) {}

  /**
   * The API key chat requests actually use: VS Code's model configuration
   * first ("Manage models" flow), extension secret storage ("GLM: Set API
   * Key" command) second. Reports which source won so that an auth failure
   * can invalidate that key and not the other one.
   */
  async resolveApiKey(): Promise<ResolvedApiKey | undefined> {
    if (this.configuredApiKey) {
      return {key: this.configuredApiKey, source: 'configuration'};
    }
    const stored = await this.authManager.getApiKey();
    return stored ? {key: stored, source: 'secret'} : undefined;
  }

  fireLanguageModelChatInformationChange(): void {
    this._onDidChangeLanguageModelChatInformation.fire();
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatInfoOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    void token;
    // An absent `configuration` is ambiguous: it may mean "not configured", or
    // it may be a resolution probe made while a key is in fact configured. We
    // cannot tell the two apart, so we list nothing but deliberately keep any
    // cached key rather than risk discarding a working one.
    if (options.configuration === undefined) {
      return [];
    }

    const raw = options.configuration.apiKey;
    const apiKey =
      typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;

    // A present `configuration` carrying no key is an affirmative signal that
    // the user cleared it, so drop the cached copy the quota poller reads.
    if (!apiKey) {
      this.configuredApiKey = undefined;
      return [];
    }

    this.configuredApiKey = apiKey;
    return TYPED_MODELS;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const resolved = await this.resolveApiKey();

    if (!resolved) {
      throw new Error(
        'API key not configured. Use "GLM: Set API Key" command.',
      );
    }

    try {
      await this.streamResponse(
        new GlmApiClient(resolved.key),
        model,
        messages,
        options,
        progress,
        token,
      );
    } catch (error) {
      // The SDK rejects the pending read when the request is aborted, so the
      // in-loop cancellation guards never get to run. Surface the user's Stop
      // as cancellation rather than as an API failure.
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      await this.throwMappedError(error, resolved.source);
    }
  }

  private resolveThinking(options?: ModelConfigurationOptions): {
    thinking?: Record<string, unknown>;
    reasoningEffort?: string;
  } {
    // GLM-5.3 family always thinks; requests cannot disable reasoning.
    // Legacy 'disabled'/'enabled' selections map to explicit effort levels.
    const effortFor = (
      mode: string,
    ): {thinking?: Record<string, unknown>; reasoningEffort?: string} => {
      switch (mode) {
        case 'low':
          return {thinking: {type: 'enabled'}, reasoningEffort: 'low'};
        case 'high':
          return {thinking: {type: 'enabled'}, reasoningEffort: 'high'};
        case 'max':
          return {thinking: {type: 'enabled'}, reasoningEffort: 'max'};
        case 'enabled':
          return {thinking: {type: 'enabled'}};
        case 'disabled':
          return {thinking: {type: 'enabled'}, reasoningEffort: 'low'};
        default:
          return {};
      }
    };

    if (options) {
      const configuredMode =
        options.modelConfiguration?.thinkingMode ??
        options.configuration?.thinkingMode;
      if (typeof configuredMode === 'string' && configuredMode !== 'auto') {
        return effortFor(configuredMode);
      }
    }

    const config = vscode.workspace
      .getConfiguration('glm-models-provider')
      .get<string>('defaultThinkingMode', 'auto');

    return effortFor(config);
  }

  private async streamResponse(
    client: GlmApiClient,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const toolCallBuilders = new Map<number, ToolCallBuilder>();

    const modelConfig = options as ModelConfigurationOptions;
    const temperature = getConfiguredTemperature(modelConfig);
    const topP = getConfiguredTopP();
    const {thinking, reasoningEffort} = this.resolveThinking(modelConfig);

    const stream = client.streamChat(
      model.id,
      convertMessages(messages),
      {
        maxTokens: options.modelOptions?.maxTokens as number | undefined,
        tools: convertTools(options.tools),
        temperature,
        topP,
        thinking,
        reasoningEffort,
        onUsage: tokenUsage => this.onUsage?.(tokenUsage, model.id),
      },
      token,
    );

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        return;
      }

      for (const choice of chunk.choices) {
        this.reportDelta(choice.delta, progress);
        this.collectToolCalls(choice.delta.tool_calls, toolCallBuilders);
        if (choice.finish_reason === 'tool_calls') {
          this.reportToolCalls(progress, toolCallBuilders);
        }
      }
    }

    this.reportToolCalls(progress, toolCallBuilders);
  }

  private reportDelta(
    delta: ChatCompletionChunk.Choice.Delta,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  ): void {
    const deltaAny = delta as Record<string, unknown>;

    const reasoningContent = deltaAny.reasoning_content;
    if (typeof reasoningContent === 'string' && reasoningContent) {
      const thinkingPart = createThinkingPart(reasoningContent);
      if (thinkingPart) {
        progress.report(thinkingPart);
      }
    }

    if (delta.content) {
      progress.report(new vscode.LanguageModelTextPart(delta.content));
    }
  }

  private collectToolCalls(
    toolCalls: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
    builders: Map<number, ToolCallBuilder>,
  ): void {
    if (!toolCalls?.length) {
      return;
    }

    for (const call of toolCalls) {
      const builder = builders.get(call.index) ?? {
        id: '',
        name: '',
        arguments: '',
      };

      if (call.id) {
        builder.id = call.id;
      }
      if (call.function?.name) {
        builder.name = call.function.name;
      }
      if (call.function?.arguments) {
        builder.arguments += call.function.arguments;
      }

      builders.set(call.index, builder);
    }
  }

  private reportToolCalls(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    builders: Map<number, ToolCallBuilder>,
  ): void {
    if (builders.size === 0) {
      return;
    }

    for (const builder of builders.values()) {
      if (!builder.id || !builder.name) {
        continue;
      }

      progress.report(
        new vscode.LanguageModelToolCallPart(
          builder.id,
          builder.name,
          parseToolArguments(builder.arguments),
        ),
      );
    }

    builders.clear();
  }

  private async throwMappedError(
    error: unknown,
    source: ApiKeySource,
  ): Promise<never> {
    if (!(error instanceof GlmApiError)) {
      throw error;
    }

    if (error.statusCode === 401) {
      throw await this.invalidateApiKey(source);
    }
    if (error.statusCode === 429) {
      throw new Error('Rate limit exceeded. Please wait and try again.');
    }
    throw new Error(`GLM API error: ${error.message}`);
  }

  /**
   * Discard only the key that actually failed. Deleting the stored key after a
   * configuration key was rejected would destroy a credential that may well be
   * valid, while leaving the failing one in place.
   */
  private async invalidateApiKey(source: ApiKeySource): Promise<Error> {
    if (source === 'secret') {
      await this.authManager.deleteApiKey();
    } else {
      this.configuredApiKey = undefined;
    }
    this.fireLanguageModelChatInformationChange();

    return new Error(
      source === 'secret'
        ? 'Invalid API key. Please set a new one using "GLM: Set API Key".'
        : 'Invalid API key. Update it in the provider settings for Z.AI GLM.',
    );
  }

  provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Thenable<number> {
    void model;
    void token;
    if (typeof text === 'string') {
      return Promise.resolve(Math.ceil(text.length / 4));
    }

    let totalChars = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        totalChars += part.value.length;
      }
    }
    return Promise.resolve(Math.ceil(totalChars / 4));
  }
}
