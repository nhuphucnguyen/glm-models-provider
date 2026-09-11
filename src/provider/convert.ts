import * as vscode from 'vscode';
import secureJsonParse from 'secure-json-parse';
import {P, match} from 'ts-pattern';
import type {GlmContentPart, GlmMessage, GlmTool, GlmToolCall} from '../api';
import {readThinkingText} from './thinking';

export type ToolCallBuilder = {
  id: string;
  name: string;
  arguments: string;
};

type ToolResult = {
  callId: string;
  content: string;
};

type MessageAccumulator = {
  text: string;
  imageParts: GlmContentPart[];
  toolCalls: GlmToolCall[];
  /** One entry per tool call answered; each becomes its own `tool` message. */
  toolResults: ToolResult[];
};

export function parseToolArguments(
  argumentsText: string,
): Record<string, unknown> {
  const parsed = secureJsonParse.safeParse(argumentsText || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

/**
 * A tool role message carries plain text, so non-text result content cannot be
 * represented. Mark it instead of dropping it silently — the model can at least
 * tell that something was returned.
 */
function toolResultItemText(item: unknown): string {
  if (item instanceof vscode.LanguageModelTextPart) {
    return item.value;
  }
  if (item instanceof vscode.LanguageModelDataPart) {
    return `[${item.mimeType} content omitted]`;
  }
  return '';
}

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): GlmMessage[] {
  return messages.flatMap(message => toGlmMessages(message));
}

/**
 * One VS Code message can carry several tool results — one per parallel tool
 * call — and each needs its own `tool` message answering its own
 * `tool_call_id`, so this returns a list rather than a single message.
 */
function toGlmMessages(
  message: vscode.LanguageModelChatRequestMessage,
): GlmMessage[] {
  const accumulated = message.content.reduce<MessageAccumulator>(
    (state, part) =>
      match(part)
        .with(P.instanceOf(vscode.LanguageModelTextPart), value => ({
          ...state,
          text: state.text + value.value,
        }))
        .with(P.instanceOf(vscode.LanguageModelToolCallPart), value => ({
          ...state,
          toolCalls: [
            ...state.toolCalls,
            {
              id: value.callId,
              type: 'function' as const,
              function: {
                name: value.name,
                arguments: JSON.stringify(value.input),
              },
            },
          ],
        }))
        .with(P.instanceOf(vscode.LanguageModelToolResultPart), value => ({
          ...state,
          toolResults: [
            ...state.toolResults,
            {
              callId: value.callId,
              content: value.content.map(toolResultItemText).join(''),
            },
          ],
        }))
        .with(P.instanceOf(vscode.LanguageModelDataPart), value => {
          if (value.mimeType.startsWith('image/')) {
            const base64 = uint8ArrayToBase64(value.data);
            return {
              ...state,
              imageParts: [
                ...state.imageParts,
                {
                  type: 'image_url' as const,
                  image_url: {url: `data:${value.mimeType};base64,${base64}`},
                },
              ],
            };
          }
          return state;
        })
        .otherwise(value => {
          const thinking = readThinkingText(value);
          return thinking ? {...state, text: state.text + thinking} : state;
        }),
    {text: '', imageParts: [], toolCalls: [], toolResults: []},
  );

  const role = mapRole(message.role);
  const messages: GlmMessage[] = accumulated.toolResults.map(result => ({
    role: 'tool' as const,
    content: result.content,
    tool_call_id: result.callId,
  }));

  if (accumulated.toolCalls.length > 0) {
    messages.push({
      role: 'assistant',
      content: accumulated.text,
      tool_calls: accumulated.toolCalls,
    });
    return messages;
  }

  if (accumulated.imageParts.length > 0) {
    const content: GlmContentPart[] = [];
    if (accumulated.text) {
      content.push({type: 'text', text: accumulated.text});
    }
    content.push(...accumulated.imageParts);
    messages.push({role, content});
    return messages;
  }

  // Text alongside tool results is kept rather than discarded, but an empty
  // message is only worth emitting when it is all we have.
  if (accumulated.text || messages.length === 0) {
    messages.push({role, content: accumulated.text});
  }
  return messages;
}

function mapRole(
  role: vscode.LanguageModelChatMessageRole,
): 'user' | 'assistant' | 'system' {
  return match(role)
    .with(
      vscode.LanguageModelChatMessageRole.Assistant,
      () => 'assistant' as const,
    )
    .with(vscode.LanguageModelChatMessageRole.User, () => 'user' as const)
    .otherwise(() => 'system' as const);
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

export function convertTools(
  tools?: readonly vscode.LanguageModelChatTool[],
): GlmTool[] | undefined {
  return tools?.length
    ? tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
        },
      }))
    : undefined;
}
