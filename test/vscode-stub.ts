/**
 * Minimal stand-in for the `vscode` module, aliased in for tests.
 *
 * The real module only exists inside the extension host, so the pure code under
 * test cannot import it. `instanceof` stand-ins alone are not enough — `mapRole`
 * reads the `LanguageModelChatMessageRole` constants, so the numeric values
 * here must match the real enum.
 */

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}

export class LanguageModelTextPart {
  constructor(public readonly value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public readonly callId: string,
    public readonly name: string,
    public readonly input: object,
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public readonly callId: string,
    public readonly content: unknown[],
  ) {}
}

export class LanguageModelDataPart {
  constructor(
    public readonly mimeType: string,
    public readonly data: Uint8Array,
  ) {}
}

export class LanguageModelPromptTsxPart {
  constructor(public readonly value: unknown) {}
}

let configuration: Record<string, unknown> = {};

/** Test-only: seed values read through `workspace.getConfiguration`. */
export function __setConfiguration(values: Record<string, unknown>): void {
  configuration = values;
}

export const workspace = {
  getConfiguration(section: string) {
    return {
      get<T>(key: string, defaultValue?: T): T | undefined {
        const value = configuration[`${section}.${key}`];
        return value === undefined ? defaultValue : (value as T);
      },
    };
  },
};
