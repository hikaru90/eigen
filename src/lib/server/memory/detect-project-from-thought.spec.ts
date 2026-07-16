import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	detectAndCreateProjectFromThought,
	detectProjectFromThought
} from './detect-project-from-thought';

const {
	llmMock,
	promoteMock,
	loadProjectsMock,
	upsertHubMock,
	linkMock
} = vi.hoisted(() => ({
	llmMock: vi.fn(),
	promoteMock: vi.fn(),
	loadProjectsMock: vi.fn(),
	upsertHubMock: vi.fn(),
	linkMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmMock
}));

vi.mock('$lib/server/memory/maybe-promote-gtd-project', () => ({
	promoteEntityToProject: promoteMock
}));

vi.mock('$lib/server/memory/project-list', () => ({
	loadEligibleGtdProjects: loadProjectsMock
}));

vi.mock('$lib/server/memory/project-entity', () => ({
	upsertGraphHubEntity: upsertHubMock
}));

vi.mock('$lib/server/memory/project-next-action', () => ({
	linkThoughtToProject: linkMock
}));

vi.mock('$lib/paraglide/messages.js', () => ({
	m: {
		llm_project_detection_system: () => 'Detect projects.'
	}
}));

describe('detectProjectFromThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns null project when LLM yields null label', async () => {
		llmMock.mockResolvedValue({
			choices: [{ message: { content: '{"projectLabel":null}' } }]
		});
		await expect(
			detectProjectFromThought({ userId: 'u1', normalizedText: 'buy milk' })
		).resolves.toEqual({ projectLabel: null });
	});

	it('returns project label from LLM JSON', async () => {
		llmMock.mockResolvedValue({
			choices: [{ message: { content: '{"projectLabel":"EigenMesh"}' } }]
		});
		await expect(
			detectProjectFromThought({
				userId: 'u1',
				normalizedText: 'Working on EigenMesh MVP'
			})
		).resolves.toEqual({ projectLabel: 'EigenMesh' });
	});

	it('throws when LLM content is missing', async () => {
		llmMock.mockResolvedValue({ choices: [{}] });
		await expect(
			detectProjectFromThought({ userId: 'u1', normalizedText: 'x' })
		).rejects.toThrow(/missing LLM content/);
	});
});

describe('detectAndCreateProjectFromThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadProjectsMock.mockResolvedValue([]);
		promoteMock.mockResolvedValue(true);
		upsertHubMock.mockResolvedValue('e1');
		linkMock.mockResolvedValue(undefined);
		llmMock.mockResolvedValue({
			choices: [{ message: { content: '{"projectLabel":"EigenMesh"}' } }]
		});
	});

	it('returns null when no project detected', async () => {
		llmMock.mockResolvedValue({
			choices: [{ message: { content: '{"projectLabel":null}' } }]
		});
		await expect(
			detectAndCreateProjectFromThought({ userId: 'u1', normalizedText: 'buy milk' })
		).resolves.toBeNull();
	});

	it('links to an existing similar project', async () => {
		loadProjectsMock.mockResolvedValue([{ entityId: 'e9', label: 'EigenMesh' }]);
		await expect(
			detectAndCreateProjectFromThought({
				userId: 'u1',
				normalizedText: 'Working on EigenMesh',
				thoughtId: 't1'
			})
		).resolves.toBe('e9');
		expect(linkMock).toHaveBeenCalledWith('u1', 'e9', 't1', 'ingest');
		expect(upsertHubMock).not.toHaveBeenCalled();
	});

	it('upserts hub, promotes, and links for a new project', async () => {
		await expect(
			detectAndCreateProjectFromThought({
				userId: 'u1',
				normalizedText: 'Working on EigenMesh',
				thoughtId: 't1'
			})
		).resolves.toBe('e1');
		expect(upsertHubMock).toHaveBeenCalledWith('u1', 'EigenMesh', 'project');
		expect(promoteMock).toHaveBeenCalled();
		expect(linkMock).toHaveBeenCalledWith('u1', 'e1', 't1', 'ingest');
	});

	it('returns null when judge rejects promotion', async () => {
		promoteMock.mockResolvedValue(false);
		await expect(
			detectAndCreateProjectFromThought({
				userId: 'u1',
				normalizedText: 'Working on EigenMesh'
			})
		).resolves.toBeNull();
	});
});
