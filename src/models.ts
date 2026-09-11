import type * as vscode from 'vscode';

export type TemperaturePreset = 'balanced' | 'precise' | 'creative' | 'max';
export type ThinkingMode = 'auto' | 'low' | 'high' | 'max';

export interface TemperaturePresetDefinition {
  readonly id: TemperaturePreset;
  readonly label: string;
  readonly value: number;
  readonly description: string;
}

/**
 * The single source for temperature presets. The model-picker schema and the
 * "GLM: Set Temperature" quick pick both derive from this — they used to carry
 * their own copies, which had already drifted into contradicting each other
 * about what 1.0 means.
 */
export const TEMPERATURE_PRESETS: readonly TemperaturePresetDefinition[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    value: 0.7,
    description: 'Standard',
  },
  {
    id: 'precise',
    label: 'Precise',
    value: 0.2,
    description: 'Precise, good for code',
  },
  {
    id: 'creative',
    label: 'Creative',
    value: 0.9,
    description: 'Creative, good for writing',
  },
  {
    id: 'max',
    label: 'Max',
    value: 1.0,
    description: 'Recommended by Z.AI',
  },
];

export const TEMPERATURE_PRESET_VALUES = Object.fromEntries(
  TEMPERATURE_PRESETS.map(preset => [preset.id, preset.value]),
) as Record<TemperaturePreset, number>;

/** Z.AI-recommended top_p for GLM-5.3 models (see docs.z.ai/guides/vlm/glm-5.3-flash). */
export const DEFAULT_TOP_P = 0.95;

function buildModelConfigurationSchema() {
  return {
    properties: {
      thinkingMode: {
        type: 'string',
        title: 'Thinking',
        enum: ['auto', 'low', 'high', 'max'],
        enumItemLabels: ['Auto', 'Low', 'High', 'Max'],
        enumDescriptions: [
          'Use the API default effort level (max)',
          'Lightweight reasoning — faster responses',
          'Enhanced reasoning',
          'Deep reasoning — best for complex tasks (default)',
        ],
        default: 'auto',
        group: 'navigation',
      },
      temperature: {
        type: 'string',
        title: 'Temperature',
        enum: [...TEMPERATURE_PRESETS.map(preset => preset.id), 'custom'],
        enumItemLabels: [
          ...TEMPERATURE_PRESETS.map(preset => preset.label),
          'Custom',
        ],
        enumDescriptions: [
          ...TEMPERATURE_PRESETS.map(
            preset => `${preset.description} (${preset.value})`,
          ),
          'Custom value set in settings',
        ],
        default: 'max',
        description: 'Presets (range: 0.0 – 1.0)',
        group: 'navigation',
      },
    },
  } as const;
}

export function getModelConfigurationSchema(): ReturnType<
  typeof buildModelConfigurationSchema
> {
  return buildModelConfigurationSchema();
}

export type ModelConfigurationOptions =
  vscode.ProvideLanguageModelChatResponseOptions & {
    readonly modelConfiguration?: Record<string, unknown>;
    readonly configuration?: Record<string, unknown>;
  };

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
  readonly isUserSelectable: boolean;
  readonly statusIcon?: vscode.ThemeIcon;
  readonly detail?: string;
  readonly tooltip?: string;
  readonly configurationSchema?: ReturnType<typeof getModelConfigurationSchema>;
};

export type ThinkingSupport = 'forced-effort';

export interface GlmModelDefinition {
  id: string;
  name: string;
  family: string;
  version: string;
  detail: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  capabilities: {
    toolCalling: boolean;
    imageInput: boolean;
    thinking: boolean;
  };
  /** 'forced-effort': thinking is always active and cannot be disabled; effort levels (low/high/max) control reasoning depth. */
  thinkingSupport: ThinkingSupport;
}

export const GLM_MODEL_DEFINITIONS: readonly GlmModelDefinition[] = [
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    family: 'glm',
    version: '5.3',
    detail: 'Z.AI',
    maxInputTokens: 1000000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: false, toolCalling: true, thinking: true},
    thinkingSupport: 'forced-effort',
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3 Flash',
    family: 'glm',
    version: '5.3-flash',
    detail: 'Z.AI',
    maxInputTokens: 1000000,
    maxOutputTokens: 131072,
    capabilities: {imageInput: true, toolCalling: true, thinking: true},
    thinkingSupport: 'forced-effort',
  },
];
