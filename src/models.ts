import type * as vscode from 'vscode';

export type TemperaturePreset = 'balanced' | 'precise' | 'creative' | 'max';
export type ThinkingMode = 'auto' | 'low' | 'high' | 'max';

export const TEMPERATURE_PRESET_VALUES: Record<TemperaturePreset, number> = {
  balanced: 0.7,
  precise: 0.2,
  creative: 0.9,
  max: 1.0,
};

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
        enum: ['balanced', 'precise', 'creative', 'max', 'custom'],
        enumItemLabels: ['Balanced', 'Precise', 'Creative', 'Max', 'Custom'],
        enumDescriptions: [
          'Standard (0.7)',
          'Low, good for code (0.2)',
          'Higher, good for writing (0.9)',
          'Highest (1.0)',
          'Custom value set in settings',
        ],
        default: 'balanced',
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
