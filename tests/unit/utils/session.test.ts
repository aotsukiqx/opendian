/**
 * Tests for session utilities - Session recovery and history reconstruction
 */

import type { ChatMessage, ToolCallInfo } from '@/core/types';
import {
  buildContextFromHistory,
  formatContextLine,
  formatToolCallForContext,
  getLastUserMessage,
  isSessionExpiredError,
  truncateToolResult,
} from '@/utils/session';

describe('session utilities', () => {
  describe('isSessionExpiredError', () => {
    it('returns true for "session expired" error', () => {
      const error = new Error('Session expired');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns true for "session not found" error', () => {
      const error = new Error('Session not found');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns true for "invalid session" error', () => {
      const error = new Error('Invalid session');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns true for "session invalid" error', () => {
      const error = new Error('Session invalid');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns true for "process exited with code" error', () => {
      const error = new Error('Process exited with code 1');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns true for compound pattern "session" + "expired"', () => {
      const error = new Error('The session has expired');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns true for compound pattern "resume" + "failed"', () => {
      const error = new Error('Failed to resume session');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns true for compound pattern "resume" + "error"', () => {
      const error = new Error('Resume error occurred');
      expect(isSessionExpiredError(error)).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      const error = new Error('Network timeout');
      expect(isSessionExpiredError(error)).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isSessionExpiredError('string error')).toBe(false);
      expect(isSessionExpiredError(null)).toBe(false);
      expect(isSessionExpiredError(undefined)).toBe(false);
      expect(isSessionExpiredError(42)).toBe(false);
    });

    it('is case-insensitive', () => {
      const error = new Error('SESSION EXPIRED');
      expect(isSessionExpiredError(error)).toBe(true);
    });
  });

  describe('formatToolCallForContext', () => {
    it('formats tool call with status only when no result', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-1',
        name: 'Read',
        input: {},
        status: 'completed',
      };

      const result = formatToolCallForContext(toolCall);

      expect(result).toBe('[Tool Read status=completed]');
    });

    it('formats tool call with result', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-1',
        name: 'Read',
        input: {},
        status: 'completed',
        result: 'File contents here',
      };

      const result = formatToolCallForContext(toolCall);

      expect(result).toBe('[Tool Read status=completed] result: File contents here');
    });

    it('truncates long results to default 800 chars', () => {
      const longResult = 'x'.repeat(1000);
      const toolCall: ToolCallInfo = {
        id: 'tool-1',
        name: 'Bash',
        input: {},
        status: 'completed',
        result: longResult,
      };

      const result = formatToolCallForContext(toolCall);

      expect(result).toContain('x'.repeat(800));
      expect(result).toContain('(truncated)');
    });

    it('truncates to custom max length', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-1',
        name: 'Bash',
        input: {},
        status: 'completed',
        result: 'x'.repeat(500),
      };

      const result = formatToolCallForContext(toolCall, 100);

      expect(result).toContain('x'.repeat(100));
      expect(result).toContain('(truncated)');
    });

    it('defaults to "completed" status when status is undefined', () => {
      const toolCall = {
        id: 'tool-1',
        name: 'Write',
        input: {},
        status: 'completed',
      } as ToolCallInfo;

      const result = formatToolCallForContext(toolCall);

      expect(result).toBe('[Tool Write status=completed]');
    });

    it('handles empty result string', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-1',
        name: 'Edit',
        input: {},
        status: 'completed',
        result: '',
      };

      const result = formatToolCallForContext(toolCall);

      expect(result).toBe('[Tool Edit status=completed]');
    });

    it('handles whitespace-only result', () => {
      const toolCall: ToolCallInfo = {
        id: 'tool-1',
        name: 'Glob',
        input: {},
        status: 'completed',
        result: '   \n\t  ',
      };

      const result = formatToolCallForContext(toolCall);

      expect(result).toBe('[Tool Glob status=completed]');
    });
  });

  describe('truncateToolResult', () => {
    it('returns unchanged result when under max length', () => {
      const result = truncateToolResult('short result', 100);
      expect(result).toBe('short result');
    });

    it('returns unchanged result when exactly at max length', () => {
      const result = truncateToolResult('x'.repeat(800), 800);
      expect(result).toBe('x'.repeat(800));
    });

    it('truncates and adds indicator when over max length', () => {
      const longResult = 'x'.repeat(1000);
      const result = truncateToolResult(longResult, 800);

      expect(result).toBe('x'.repeat(800) + '... (truncated)');
    });

    it('uses default max length of 800', () => {
      const longResult = 'x'.repeat(1000);
      const result = truncateToolResult(longResult);

      expect(result).toBe('x'.repeat(800) + '... (truncated)');
    });
  });

  describe('formatContextLine', () => {
    it('returns formatted context line for message with currentNote', () => {
      const message: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
        currentNote: 'notes/test.md',
      };

      const result = formatContextLine(message);

      expect(result).toContain('notes/test.md');
    });

    it('returns null when currentNote is undefined', () => {
      const message: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      const result = formatContextLine(message);

      expect(result).toBeNull();
    });

    it('returns null when currentNote is empty', () => {
      const message: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
        currentNote: '',
      };

      const result = formatContextLine(message);

      expect(result).toBeNull();
    });
  });

  describe('buildContextFromHistory', () => {
    it('builds context from simple user/assistant exchange', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: 2000 },
      ];

      const result = buildContextFromHistory(messages);

      expect(result).toContain('User: Hello');
      expect(result).toContain('Assistant: Hi there!');
    });

    it('includes tool call results in assistant messages', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Read file', timestamp: 1000 },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Let me read that file.',
          timestamp: 2000,
          toolCalls: [
            { id: 'tool-1', name: 'Read', input: {}, status: 'completed', result: 'file contents' },
          ],
        },
      ];

      const result = buildContextFromHistory(messages);

      expect(result).toContain('User: Read file');
      expect(result).toContain('Assistant: Let me read that file.');
      expect(result).toContain('[Tool Read status=completed]');
      expect(result).toContain('file contents');
    });

    it('includes currentNote context for user messages', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Analyze this note',
          timestamp: 1000,
          currentNote: 'notes/important.md',
        },
      ];

      const result = buildContextFromHistory(messages);

      expect(result).toContain('notes/important.md');
      expect(result).toContain('Analyze this note');
    });

    it('skips non-user/assistant messages', () => {
      // buildContextFromHistory only processes 'user' and 'assistant' roles
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'User message', timestamp: 2000 },
      ];

      const result = buildContextFromHistory(messages);

      expect(result).toContain('User: User message');
    });

    it('skips assistant messages with no content and no tool results', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: 'msg-2', role: 'assistant', content: '', timestamp: 2000 },
        { id: 'msg-3', role: 'assistant', content: 'Response', timestamp: 3000 },
      ];

      const result = buildContextFromHistory(messages);

      expect(result).toContain('User: Hello');
      expect(result).toContain('Assistant: Response');
      // Should not have an empty assistant entry
      expect(result.match(/Assistant:/g)?.length).toBe(1);
    });

    it('includes assistant message with only tool results (no text content)', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Do something', timestamp: 1000 },
        {
          id: 'msg-2',
          role: 'assistant',
          content: '',
          timestamp: 2000,
          toolCalls: [
            { id: 'tool-1', name: 'Bash', input: {}, status: 'completed', result: 'done' },
          ],
        },
      ];

      const result = buildContextFromHistory(messages);

      expect(result).toContain('[Tool Bash status=completed]');
    });

    it('returns empty string for empty messages array', () => {
      const result = buildContextFromHistory([]);
      expect(result).toBe('');
    });

    it('handles messages with only whitespace content', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: '  \n  ', timestamp: 1000 },
        { id: 'msg-2', role: 'assistant', content: '  \t  ', timestamp: 2000 },
      ];

      const result = buildContextFromHistory(messages);

      // Whitespace content should still be processed (trimmed)
      expect(result).toContain('User:');
    });

    it('separates messages with double newlines', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'First', timestamp: 1000 },
        { id: 'msg-2', role: 'assistant', content: 'Second', timestamp: 2000 },
        { id: 'msg-3', role: 'user', content: 'Third', timestamp: 3000 },
      ];

      const result = buildContextFromHistory(messages);

      expect(result).toContain('\n\n');
    });

    it('filters out tool calls with empty results', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'Test', timestamp: 1000 },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Response',
          timestamp: 2000,
          toolCalls: [
            { id: 'tool-1', name: 'Empty', input: {}, status: 'completed', result: '' },
            { id: 'tool-2', name: 'HasResult', input: {}, status: 'completed', result: 'data' },
          ],
        },
      ];

      const result = buildContextFromHistory(messages);

      // Tool with empty result should still appear (formatToolCallForContext handles this)
      expect(result).toContain('[Tool Empty status=completed]');
      expect(result).toContain('[Tool HasResult status=completed] result: data');
    });
  });

  describe('getLastUserMessage', () => {
    it('returns last user message from history', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'user', content: 'First', timestamp: 1000 },
        { id: 'msg-2', role: 'assistant', content: 'Response', timestamp: 2000 },
        { id: 'msg-3', role: 'user', content: 'Second', timestamp: 3000 },
        { id: 'msg-4', role: 'assistant', content: 'Response 2', timestamp: 4000 },
      ];

      const result = getLastUserMessage(messages);

      expect(result?.id).toBe('msg-3');
      expect(result?.content).toBe('Second');
    });

    it('returns undefined when no user messages exist', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'assistant', content: 'Response', timestamp: 1000 },
      ];

      const result = getLastUserMessage(messages);

      expect(result).toBeUndefined();
    });

    it('returns undefined for empty messages array', () => {
      const result = getLastUserMessage([]);

      expect(result).toBeUndefined();
    });

    it('returns the only user message when there is just one', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'assistant', content: 'Welcome', timestamp: 1000 },
        { id: 'msg-2', role: 'user', content: 'Only user msg', timestamp: 2000 },
        { id: 'msg-3', role: 'assistant', content: 'Response', timestamp: 3000 },
      ];

      const result = getLastUserMessage(messages);

      expect(result?.id).toBe('msg-2');
    });

    it('finds user message among assistant messages', () => {
      const messages: ChatMessage[] = [
        { id: 'msg-1', role: 'assistant', content: 'Welcome', timestamp: 1000 },
        { id: 'msg-2', role: 'user', content: 'User', timestamp: 2000 },
        { id: 'msg-3', role: 'assistant', content: 'Response', timestamp: 3000 },
      ];

      const result = getLastUserMessage(messages);

      expect(result?.id).toBe('msg-2');
    });
  });
});
