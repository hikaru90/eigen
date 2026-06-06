import { describe, expect, it } from 'vitest';
import {
	filterAcceptedEntityMentions,
	isRejectedEntitySurface
} from './entity-mention-filter';

describe('isRejectedEntitySurface', () => {
	it('rejects common greetings regardless of casing', () => {
		expect(isRejectedEntitySurface('Hallo')).toBe(true);
		expect(isRejectedEntitySurface('hello')).toBe(true);
		expect(isRejectedEntitySurface('Hi')).toBe(true);
	});

	it('accepts real person and place names', () => {
		expect(isRejectedEntitySurface('Alex')).toBe(false);
		expect(isRejectedEntitySurface('Anni')).toBe(false);
		expect(isRejectedEntitySurface('Berlin')).toBe(false);
	});
});

describe('filterAcceptedEntityMentions', () => {
	it('drops greeting mentions but keeps proper names', () => {
		const filtered = filterAcceptedEntityMentions([
			{ surface: 'Hallo', entityType: 'person', confidence: 0.9 },
			{ surface: 'Alex', entityType: 'person', confidence: 0.95 }
		]);
		expect(filtered).toEqual([{ surface: 'Alex', entityType: 'person', confidence: 0.95 }]);
	});
});
