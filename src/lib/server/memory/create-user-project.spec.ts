import { describe, expect, it, vi } from 'vitest';
import { createUserDeclaredProject } from './create-user-project';

const {
	resolveProjectIdentityMock,
	promoteHubEntityTypeMock,
	ensureProjectProfileMock
} = vi.hoisted(() => ({
	resolveProjectIdentityMock: vi.fn(async () => ({
		entityId: 'proj-1',
		canonicalLabel: 'EigenMesh',
		hubEntityType: 'organization',
		isGtdProject: true,
		shouldCreateHub: true,
		mergeEntityIds: []
	})),
	promoteHubEntityTypeMock: vi.fn(async () => undefined),
	ensureProjectProfileMock: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/memory/resolve-project-identity', () => ({
	resolveProjectIdentity: resolveProjectIdentityMock
}));

vi.mock('$lib/server/memory/project-entity', () => ({
	promoteHubEntityType: promoteHubEntityTypeMock
}));

vi.mock('$lib/server/memory/project-eligibility', () => ({
	ensureProjectProfile: ensureProjectProfileMock
}));

describe('createUserDeclaredProject', () => {
	it('promotes hub and creates manual project profile without judge', async () => {
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
		expect(promoteHubEntityTypeMock).toHaveBeenCalledWith('u1', 'proj-1', 'EigenMesh');
		expect(ensureProjectProfileMock).toHaveBeenCalledWith('u1', 'proj-1', 'active', 'manual');
	});

	it('rejects empty label', async () => {
		await expect(createUserDeclaredProject({ userId: 'u1', label: '  ' })).rejects.toThrow(
			'label is required'
		);
	});
});
