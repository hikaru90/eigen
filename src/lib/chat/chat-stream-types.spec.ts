import { describe, expect, it } from 'vitest';
import {
	coerceToolResultSource,
	evidenceHitsFromAnswerQuestionPayload,
	formatToolArgumentsSummary,
	formatToolResultForDisplay,
	isToolResultFailed,
	parseComposedAnswerSections,
	parseFinalAnswerText,
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

	it('formats compact retrieve_thoughts candidates as numbered list', () => {
		const preview = JSON.stringify({
			count: 1,
			candidates: [{ id: 't1', snippet: 'i do like sweet coffee', category: 'thought' }]
		});
		expect(formatToolResultForDisplay('retrieve_thoughts', preview)).toBe(
			'1. i do like sweet coffee'
		);
	});

	it('parses list_thoughts snippet rows with ids into memory hits', () => {
		const raw = JSON.stringify({
			count: 2,
			thoughts: [
				{ id: 't-home', snippet: 'Ich arbeite heute von zu Hause aus.', category: 'thought' },
				{ id: 't-app', snippet: 'ich würde heute nachmittag gerne noch die app trennen', category: 'idea' }
			]
		});
		const view = resolveToolResultView('list_thoughts', raw, raw);
		expect(view).toEqual({
			kind: 'memories',
			hits: [
				{ id: 't-home', text: 'Ich arbeite heute von zu Hause aus.', category: 'thought' },
				{ id: 't-app', text: 'ich würde heute nachmittag gerne noch die app trennen', category: 'idea' }
			]
		});
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

	it('dedupes repeated memory hits by id and by text/category fallback', () => {
		const raw = JSON.stringify({
			results: [
				{ id: 't1', normalizedText: 'Annie ist meine Schwester', category: 'reference' },
				{ id: 't1', normalizedText: 'Annie ist meine Schwester', category: 'reference' },
				{ normalizedText: 'Annie ist meine Schwester', category: 'reference' },
				{ normalizedText: 'annie ist meine schwester', category: 'reference' }
			]
		});
		const view = resolveToolResultView('retrieve_thoughts', raw, raw);
		expect(view).toEqual({
			kind: 'memories',
			hits: [{ id: 't1', text: 'Annie ist meine Schwester', category: 'reference' }]
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
				{ id: '829b4cc7', text: 'i do like sweet coffee', category: 'emotion' },
				{ id: '5a9ca204', text: 'ich mag kaffee', category: undefined }
			]
		});
	});

	it('parses evidence ids from [id=uuid] citations', () => {
		const raw =
			'Answer: You are home. [id=d2af9064-8fbe-490a-856a-ccaee8410516]\nEvidence:\n- You are working from home today. [id=d2af9064-8fbe-490a-856a-ccaee8410516]\nUnknown:\n- none';
		expect(parseComposedAnswerSections(raw).evidenceLines).toEqual([
			{
				text: 'You are working from home today.',
				id: 'd2af9064-8fbe-490a-856a-ccaee8410516'
			}
		]);
	});

	it('parses evidence ids from [<id=uuid>] citations', () => {
		const raw =
			'Answer: You are home. [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]\nEvidence:\n- You are working from home today. [<id=d2af9064-8fbe-490a-856a-ccaee8410516>]\nUnknown:\n- none';
		expect(parseComposedAnswerSections(raw).evidenceLines).toEqual([
			{
				text: 'You are working from home today.',
				id: 'd2af9064-8fbe-490a-856a-ccaee8410516'
			}
		]);
	});

	it('parses composed answer sections without headers in final text', () => {
		const raw =
			'Answer: Annie ist deine Schwester. [id1]\n\nEvidence:\n- Annie ist meine Schwester [id1]\n\nUnknown:\n- none';
		expect(parseComposedAnswerSections(raw).answerText).toBe('Annie ist deine Schwester. [id1]');
		expect(parseComposedAnswerSections(raw).evidenceLines).toEqual([
			{ text: 'Annie ist meine Schwester', id: 'id1' }
		]);
	});

	it('parseFinalAnswerText uses answer field from tool_result JSON', () => {
		const preview = JSON.stringify({
			answer:
				'Answer: Annie ist deine Schwester. [t1]\nEvidence:\n- Annie ist meine Schwester [t1]\nUnknown:\n- none',
			citations: ['t1'],
			retrieved: [{ id: 't1', normalizedText: 'Annie ist meine Schwester', category: 'reference' }]
		});
		expect(parseFinalAnswerText('ignored', preview)).toBe('Annie ist deine Schwester. [t1]');
		expect(evidenceHitsFromAnswerQuestionPayload(preview)).toEqual([
			{ id: 't1', text: 'Annie ist meine Schwester', category: 'reference' }
		]);
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
