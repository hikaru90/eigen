import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRelevanceCheckInAnswer } from '$lib/server/grounding/relevance-answer';

const { updateMock, archiveThoughtForUserMock } = vi.hoisted(() => ({
	updateMock: vi.fn(),
	archiveThoughtForUserMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		update: updateMock
	})
}));

vi.mock('$lib/server/memory/lifecycle', () => ({
	archiveThoughtForUser: archiveThoughtForUserMock
}));

describe('applyRelevanceCheckInAnswer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: 't1' }])
				})
			})
		});
		archiveThoughtForUserMock.mockResolvedValue({ ok: true, thought: { id: 't1' } });
	});

	it('keeps by bumping access/salience', async () => {
		const result = await applyRelevanceCheckInAnswer({
			userId: 'u1',
			thoughtId: 't1',
			action: 'keep'
		});
		expect(result).toEqual({ ok: true, action: 'keep' });
		expect(updateMock).toHaveBeenCalled();
		expect(archiveThoughtForUserMock).not.toHaveBeenCalled();
	});

	it('archives via lifecycle helper', async () => {
		const result = await applyRelevanceCheckInAnswer({
			userId: 'u1',
			thoughtId: 't1',
			action: 'archive'
		});
		expect(result).toEqual({ ok: true, action: 'archive' });
		expect(archiveThoughtForUserMock).toHaveBeenCalledWith('u1', 't1');
	});

	it('returns not_found when keep update matches nothing', async () => {
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([])
				})
			})
		});
		const result = await applyRelevanceCheckInAnswer({
			userId: 'u1',
			thoughtId: 'missing',
			action: 'keep'
		});
		expect(result).toEqual({ ok: false, reason: 'not_found' });
	});
});
