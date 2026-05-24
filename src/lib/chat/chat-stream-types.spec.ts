import { describe, expect, it } from 'vitest';
import {
	formatToolArgumentsSummary,
	formatToolResultForDisplay,
	isToolResultFailed,
	toolCategoryClasses,
	toolVisual
} from './chat-stream-types';

describe('chat-stream-types', () => {
	it('assigns distinct categories per known tool', () => {
		expect(toolVisual('retrieve_thoughts').category).toBe('search');
		expect(toolVisual('capture_thought').category).toBe('write');
		expect(toolVisual('delete_thought').category).toBe('destructive');
		expect(toolCategoryClasses('search').border).toContain('sky');
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
});
