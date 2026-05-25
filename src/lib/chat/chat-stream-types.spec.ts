import { describe, expect, it } from 'vitest';
import {
	coerceToolResultSource,
	formatToolArgumentsSummary,
	formatToolResultForDisplay,
	isToolResultFailed,
	resolveToolResultView,
	toolCategoryClasses,
	toolVisual
} from './chat-stream-types';

describe('chat-stream-types', () => {
	it('assigns distinct categories per known tool', () => {
		expect(toolVisual('retrieve_thoughts').category).toBe('search');
		expect(toolVisual('capture_thought').category).toBe('write');
		expect(toolVisual('delete_thought').category).toBe('destructive');
		expect(toolCategoryClasses('search').icon).toContain('muted');
	});

	it('summarizes retrieve_thoughts query argument', () => {
		expect(
			formatToolArgumentsSummary('retrieve_thoughts', { query: 'how do I like my coffee' })
		).toBe('how do I like my coffee');
	});

	it('formats tool error results for display', () => {
		const preview = JSON.stringify({ error: 'Thought not found' });
		expect(isToolResultFailed(preview)).toBe(true);
		expect(formatToolResultForDisplay('edit_thought', preview)).toBe('Error: Thought not found');
	});

	it('formats retrieve_thoughts hits as numbered list', () => {
		const preview = JSON.stringify({
			results: [{ normalizedText: 'i do like sweet coffee' }]
		});
		expect(formatToolResultForDisplay('retrieve_thoughts', preview)).toBe(
			'1. i do like sweet coffee'
		);
	});

	it('parses raw JSON displaySummary into memory hits', () => {
		const raw = JSON.stringify({
			results: [
				{ id: '829b4cc7-ee30-403f-975b-f4663f52eb00', normalizedText: 'i do like sweet coffee', category: 'emotion' }
			]
		});
		const view = resolveToolResultView('retrieve_thoughts', raw, raw);
		expect(view).toEqual({
			kind: 'memories',
			hits: [{ id: '829b4cc7-ee30-403f-975b-f4663f52eb00', text: 'i do like sweet coffee', category: 'emotion' }]
		});
	});

	it('coerces jsonb object metadata into parseable memory hits', () => {
		const obj = {
			results: [{ normalizedText: 'ich mag kaffee', category: 'thought' }]
		};
		const view = resolveToolResultView(
			'retrieve_thoughts',
			'',
			coerceToolResultSource(obj)
		);
		expect(view).toEqual({
			kind: 'memories',
			hits: [{ text: 'ich mag kaffee', category: 'thought' }]
		});
	});

	it('salvages normalizedText from truncated legacy JSON', () => {
		const broken =
			'{"results":[{"id":"829b4cc7","normalizedText":"i do like sweet coffee","category":"emotion"},{"id":"5a9ca204","normalizedText":"ich mag kaffee"';
		const view = resolveToolResultView('retrieve_thoughts', broken, broken);
		expect(view).toEqual({
			kind: 'memories',
			hits: [
				{ text: 'i do like sweet coffee', category: 'emotion' },
				{ text: 'ich mag kaffee', category: undefined }
			]
		});
	});

	it('does not surface raw JSON as text for legacy payloads', () => {
		const raw = JSON.stringify({
			results: [{ normalizedText: 'i do like sweet coffee' }]
		});
		const view = resolveToolResultView('retrieve_thoughts', raw, raw);
		expect(view.kind).not.toBe('text');
		if (view.kind === 'text') expect(view.text).not.toContain('"results"');
	});
});
