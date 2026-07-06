import { describe, expect, it, vi } from 'vitest';
import { createUserDeclaredProject } from './create-user-project';

const {
	upsertGraphHubEntityMock,
	promoteHubEntityTypeMock,
	ensureProjectProfileMock
} = vi.hoisted(() => ({
	upsertGraphHubEntityMock: vi.fn(async () => 'proj-1'),
	promoteHubEntityTypeMock: vi.fn(async () => undefined),
	ensureProjectProfileMock: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/memory/project-entity', () => ({
	upsertGraphHubEntity: upsertGraphHubEntityMock,
	promoteHubEntityType: promoteHubEntityTypeMock
}));

vi.mock('$lib/server/memory/project-eligibility', () => ({
	ensureProjectProfile: ensureProjectProfileMock
}));

describe('createUserDeclaredProject', () => {
	it('creates hub and manual project profile without LLM identity resolution', async () => {
		const result = await createUserDeclaredProject({
			userId: 'u1',
			label: 'EigenMesh',
			status: 'active'
		});

		expect(result).toEqual({
			entityId: 'proj-1',
			label: 'EigenMesh',
			status: 'active'
		});
		expect(upsertGraphHubEntityMock).toHaveBeenCalledWith('u1', 'EigenMesh', 'project');
		expect(promoteHubEntityTypeMock).toHaveBeenCalledWith('u1', 'proj-1', 'EigenMesh');
		expect(ensureProjectProfileMock).toHaveBeenCalledWith('u1', 'proj-1', 'active', 'manual');
	});

	it('rejects empty label', async () => {
		await expect(createUserDeclaredProject({ userId: 'u1', label: '  ' })).rejects.toThrow(
			'label is required'
		);
	});
});
