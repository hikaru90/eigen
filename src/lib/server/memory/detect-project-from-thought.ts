/**
 * Detect projects from thought content during enrichment.
 */

import { llmChatCompletion } from '$lib/server/llm/llm-client';
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content';
import { m } from '$lib/paraglide/messages.js';
import { promoteEntityToProject } from '$lib/server/memory/maybe-promote-gtd-project';
import { loadEligibleGtdProjects } from '$lib/server/memory/project-list';
import { upsertGraphHubEntity } from '$lib/server/memory/project-entity';
import { linkThoughtToProject } from '$lib/server/memory/project-next-action';

export type ProjectDetectionResult = {
	projectLabel: string | null;
};

export type ProjectDetectionInput = {
	userId: string;
	normalizedText: string;
	thoughtId?: string;
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

async function findSimilarProject(
	userId: string,
	projectLabel: string
): Promise<{ entityId: string; label: string } | null> {
	const projects = await loadEligibleGtdProjects(userId);
	const normalized = projectLabel.toLowerCase().trim();

	for (const project of projects) {
		if (project.label.toLowerCase().trim() === normalized) {
			return { entityId: project.entityId, label: project.label };
		}
	}

	for (const project of projects) {
		const existingLabel = project.label.toLowerCase().trim();
		if (normalized.includes(existingLabel) || existingLabel.includes(normalized)) {
			return { entityId: project.entityId, label: project.label };
		}
	}

	return null;
}

/** Detect project from thought and promote through the unified LLM judge path. */
export async function detectAndCreateProjectFromThought(
	input: ProjectDetectionInput
): Promise<string | null> {
	const detection = await detectProjectFromThought(input);

	if (!detection.projectLabel) {
		console.log('[project-detection] No project detected in thought', {
			userId: input.userId,
			normalizedTextPreview: input.normalizedText.slice(0, 100)
		});
		return null;
	}

	const existing = await findSimilarProject(input.userId, detection.projectLabel);
	if (existing) {
		if (input.thoughtId) {
			await linkThoughtToProject(input.userId, existing.entityId, input.thoughtId, 'ingest');
		}
		return existing.entityId;
	}

	const entityId = await upsertGraphHubEntity(input.userId, detection.projectLabel, 'project');
	const promoted = await promoteEntityToProject({
		userId: input.userId,
		entityId,
		source: 'capture',
		forceJudge: false
	});

	if (!promoted) {
		console.log('[project-detection] LLM judge rejected project promotion', {
			userId: input.userId,
			entityId,
			label: detection.projectLabel
		});
		return null;
	}

	if (input.thoughtId) {
		await linkThoughtToProject(input.userId, entityId, input.thoughtId, 'ingest');
	}

	console.log('[project-detection] Promoted new project', {
		userId: input.userId,
		entityId,
		label: detection.projectLabel
	});

	return entityId;
}
