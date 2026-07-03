/**
 * Detect projects from thought content during enrichment.
 *
 * Simple approach: If the user mentions a project, it IS a project.
 * - Extract the project name from the thought
 * - Check if a similar project exists
 * - If exists: associate thought with it
 * - If not: create the project
 */

import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import { m } from '$lib/paraglide/messages.js';
import { loadEligibleGtdProjects } from '$lib/server/memory/project-list';
import { upsertGraphHubEntity, promoteHubEntityType } from '$lib/server/memory/project-entity';
import { ensureProjectProfile } from '$lib/server/memory/project-eligibility';

export type ProjectDetectionResult = {
	projectLabel: string | null;
};

export type ProjectDetectionInput = {
	userId: string;
	normalizedText: string;
};

function extractChatContent(response: unknown): string {
	const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices;
	const content = choices?.[0]?.message?.content;
	if (typeof content !== 'string') {
		throw new Error('detectProjectFromThought: missing LLM content');
	}
	return content;
}

function parseProjectDetectionPayload(raw: unknown): ProjectDetectionResult {
	if (!raw || typeof raw !== 'object') {
		return { projectLabel: null };
	}
	const obj = raw as Record<string, unknown>;

	const projectLabel =
		typeof obj.projectLabel === 'string' && obj.projectLabel.trim()
			? obj.projectLabel.trim()
			: typeof obj.project_label === 'string' && obj.project_label.trim()
				? obj.project_label.trim()
				: null;

	return { projectLabel };
}

function buildDetectionPrompt(input: ProjectDetectionInput): string {
	return [
		'Return ONLY JSON:',
		'{',
		'  "projectLabel": "project name or null"',
		'}',
		'',
		'Analyze this note to extract a project name if one is mentioned.',
		'',
		'A project is any named initiative, product, app, research effort, or body of work the user is working on.',
		'Examples:',
		'- "Working on EigenMesh MVP" → "EigenMesh"',
		'- "Need to finish the auth module for MySaaS" → "MySaaS"',
		'- "Research paper on quantum computing is progressing" → "Quantum Computing Research"',
		'- "The kitchen renovation is behind schedule" → "Kitchen Renovation"',
		'',
		'NOT a project (return null):',
		'- Generic tasks without a named initiative: "buy groceries", "call dentist"',
		'- Facts or references: "React is a library"',
		'- Events: "Meeting tomorrow at 3pm"',
		'- Concerns without a named project: "Worried about the deadline"',
		'',
		'Extract the project name as it would naturally be called (not the full sentence).',
		'If multiple projects are mentioned, pick the primary one.',
		'',
		`Note: ${input.normalizedText}`
	].join('\n');
}

/**
 * Extract project name from thought if one is mentioned.
 */
export async function detectProjectFromThought(
	input: ProjectDetectionInput
): Promise<ProjectDetectionResult> {
	const response = await llmChatCompletion({
		userId: input.userId,
		messages: [
			{
				role: 'system',
				content: m.llm_project_detection_system()
			},
			{ role: 'user', content: buildDetectionPrompt(input) }
		],
		temperature: 0
	});

	const parsed = JSON.parse(stripMarkdownJsonFences(extractChatContent(response))) as unknown;
	return parseProjectDetectionPayload(parsed);
}

/**
 * Find an existing project with a similar name.
 */
async function findSimilarProject(
	userId: string,
	projectLabel: string
): Promise<{ entityId: string; label: string } | null> {
	const projects = await loadEligibleGtdProjects(userId);
	const normalized = projectLabel.toLowerCase().trim();

	// Exact match
	for (const project of projects) {
		if (project.label.toLowerCase().trim() === normalized) {
			return { entityId: project.entityId, label: project.label };
		}
	}

	// Fuzzy match - check if either name contains the other
	for (const project of projects) {
		const existingLabel = project.label.toLowerCase().trim();
		if (normalized.includes(existingLabel) || existingLabel.includes(normalized)) {
			return { entityId: project.entityId, label: project.label };
		}
	}

	return null;
}

/**
 * Detect project from thought and create/associate as needed.
 * Returns the project entity ID if found or created, null otherwise.
 */
export async function detectAndCreateProjectFromThought(
	input: ProjectDetectionInput
): Promise<string | null> {
	// Extract project name from thought
	const detection = await detectProjectFromThought(input);

	if (!detection.projectLabel) {
		return null;
	}

	// Check for similar existing project
	const existing = await findSimilarProject(input.userId, detection.projectLabel);
	if (existing) {
		return existing.entityId;
	}

	// Create new project
	const entityId = await upsertGraphHubEntity(input.userId, detection.projectLabel, 'project');
	await promoteHubEntityType(input.userId, entityId, detection.projectLabel);
	await ensureProjectProfile(input.userId, entityId, 'active', 'capture');

	// Log the creation for audit
	console.log('[project-detection] Created new project', {
		userId: input.userId,
		entityId,
		label: detection.projectLabel
	});

	return entityId;
}
