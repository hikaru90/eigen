import { describe, expect, it } from 'vitest';
import { classifyQueryType } from './query-router';

describe('classifyQueryType', () => {
	describe('self-profile queries', () => {
		it.each([
			'What do you know about me?',
			'What do you remember about me?',
			'was weißt du über mich?',
			'Was weisst du uber mich?',
			'wer bin ich?'
		])('classifies "%s" as global', (query) => {
			expect(classifyQueryType(query)).toBe('global');
		});
	});

	describe('global queries', () => {
		it.each([
			'What are my recurring patterns?',
			'What are my main themes?',
			'What trends have I noticed?',
			'I tend to procrastinate on big decisions',
			'What do my notes say about my habits?',
			'Give me an overall summary of my work concerns',
			'What keeps coming up in my notes?',
			'What are my main worries?',
			'What has been recurring in my captures?',
			'What kind of problems do I usually face?',
			'How do I tend to handle conflict?',
			'Big picture — what is going on with my work?'
		])('classifies "%s" as global', (query) => {
			expect(classifyQueryType(query)).toBe('global');
		});
	});

	describe('relational queries', () => {
		it.each([
			'What do I know about Anna?',
			'Tell me about the Q3 project',
			'Everything about Marcus',
			'What is my relationship with Sarah?',
			'All notes related to pricing',
			'Who is Thomas?',
			'My history with the Berlin office'
		])('classifies "%s" as relational', (query) => {
			expect(classifyQueryType(query)).toBe('relational');
		});

		it('detects proper nouns mid-sentence as relational', () => {
			expect(classifyQueryType('what did Anna say about the contract?')).toBe('relational');
			expect(classifyQueryType('when did Marcus call me?')).toBe('relational');
		});
	});

	describe('local queries', () => {
		it.each([
			'when did I last capture a note?',
			'what was the pricing decision?',
			'find the note about the meeting',
			'contract renewal details'
		])('classifies "%s" as local', (query) => {
			expect(classifyQueryType(query)).toBe('local');
		});
	});

	it('defaults to local for ambiguous queries', () => {
		expect(classifyQueryType('hello')).toBe('local');
		expect(classifyQueryType('meeting notes')).toBe('local');
	});
});
