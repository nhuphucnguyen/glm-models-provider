import {describe, expect, it} from 'vitest';
import {
  LanguageModelChatMessageRole,
  LanguageModelDataPart,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from './vscode-stub';
import {convertMessages, parseToolArguments} from '../src/provider/convert';

type Message = Parameters<typeof convertMessages>[0][number];

function userMessage(content: unknown[]): Message {
  return {
    role: LanguageModelChatMessageRole.User,
    content,
    name: undefined,
  } as unknown as Message;
}

function assistantMessage(content: unknown[]): Message {
  return {
    role: LanguageModelChatMessageRole.Assistant,
    content,
    name: undefined,
  } as unknown as Message;
}

describe('convertMessages', () => {
  it('emits one tool message per parallel tool result', () => {
    const result = convertMessages([
      userMessage([
        new LanguageModelToolResultPart('call_a', [
          new LanguageModelTextPart('alpha'),
        ]),
        new LanguageModelToolResultPart('call_b', [
          new LanguageModelTextPart('beta'),
        ]),
      ]),
    ]);

    expect(result).toEqual([
      {role: 'tool', content: 'alpha', tool_call_id: 'call_a'},
      {role: 'tool', content: 'beta', tool_call_id: 'call_b'},
    ]);
  });

  it('keeps text that arrives alongside a tool result', () => {
    const result = convertMessages([
      userMessage([
        new LanguageModelToolResultPart('call_a', [
          new LanguageModelTextPart('tool output'),
        ]),
        new LanguageModelTextPart('and a follow-up question'),
      ]),
    ]);

    expect(result).toEqual([
      {role: 'tool', content: 'tool output', tool_call_id: 'call_a'},
      {role: 'user', content: 'and a follow-up question'},
    ]);
  });

  it('marks non-text tool result content instead of dropping it', () => {
    const result = convertMessages([
      userMessage([
        new LanguageModelToolResultPart('call_a', [
          new LanguageModelTextPart('see: '),
          new LanguageModelDataPart('image/png', new Uint8Array([1, 2, 3])),
        ]),
      ]),
    ]);

    expect(result).toEqual([
      {
        role: 'tool',
        content: 'see: [image/png content omitted]',
        tool_call_id: 'call_a',
      },
    ]);
  });

  it('does not emit an empty message when only tool results are present', () => {
    const result = convertMessages([
      userMessage([
        new LanguageModelToolResultPart('call_a', [
          new LanguageModelTextPart('only this'),
        ]),
      ]),
    ]);

    expect(result).toHaveLength(1);
  });

  it('still emits an empty message when there is no content at all', () => {
    expect(convertMessages([userMessage([])])).toEqual([
      {role: 'user', content: ''},
    ]);
  });

  it('converts tool calls into an assistant message', () => {
    const result = convertMessages([
      assistantMessage([
        new LanguageModelTextPart('calling'),
        new LanguageModelToolCallPart('call_a', 'search', {q: 'glm'}),
      ]),
    ]);

    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          {
            id: 'call_a',
            type: 'function',
            function: {name: 'search', arguments: '{"q":"glm"}'},
          },
        ],
      },
    ]);
  });

  it('encodes image parts as data URLs beside their text', () => {
    const result = convertMessages([
      userMessage([
        new LanguageModelTextPart('what is this?'),
        new LanguageModelDataPart('image/png', new Uint8Array([1, 2, 3])),
      ]),
    ]);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          {type: 'text', text: 'what is this?'},
          {
            type: 'image_url',
            image_url: {url: 'data:image/png;base64,AQID'},
          },
        ],
      },
    ]);
  });

  it('maps assistant and user roles, defaulting everything else to system', () => {
    const result = convertMessages([
      assistantMessage([new LanguageModelTextPart('a')]),
      userMessage([new LanguageModelTextPart('u')]),
      {
        role: 99,
        content: [new LanguageModelTextPart('s')],
      } as unknown as Message,
    ]);

    expect(result.map(message => message.role)).toEqual([
      'assistant',
      'user',
      'system',
    ]);
  });
});

describe('parseToolArguments', () => {
  it('parses an object', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({a: 1});
  });

  it('treats empty input as an empty object', () => {
    expect(parseToolArguments('')).toEqual({});
  });

  it('rejects non-object JSON', () => {
    expect(parseToolArguments('[1,2]')).toEqual({});
    expect(parseToolArguments('"text"')).toEqual({});
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseToolArguments('{not json')).toEqual({});
  });
});
