import type { CaptureIngestPhase } from '$lib/capture/ingest-phases';
import { CAPTURE_PIPELINE } from '$lib/capture/ingest-phases';
import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';
import { ontologyFillForKey, type GraphLegendSection } from '$lib/graph/graph-ontology-legend';
import type { TemporalEventListItem } from '../../../routes/api/temporal-events/+server';

export const DEMO_CAPTURE_TEXT = 'Follow up with Alex on migration blockers — due early April.';

/** Simulated voice transcript — same intent as typed capture, slightly spoken phrasing. */
export const DEMO_VOICE_TRANSCRIPT =
	'Follow up with Alex on migration blockers due early April.';

export const DEMO_STORED_THOUGHT = {
	id: 'th_demo_018f4a',
	normalizedText: 'Follow up with Alex on migration blockers by early April.',
	category: 'task',
	categoryConfidence: 0.91
} as const;

export const DEMO_GRAPH_LEGEND: GraphLegendSection[] = [
	{
		title: 'Your ontology: entity kinds',
		items: [
			{
				key: 'onto-entity-task',
				label: 'Task',
				hint: 'Actionable work items',
				fill: ontologyFillForKey('task')
			},
			{
				key: 'onto-entity-reference',
				label: 'Reference',
				hint: 'External facts and blockers',
				fill: ontologyFillForKey('reference')
			},
			{
				key: 'onto-entity-person',
				label: 'Person',
				hint: 'People mentioned in captures',
				fill: ontologyFillForKey('person')
			},
			{
				key: 'onto-entity-idea',
				label: 'Idea',
				hint: 'Ideas and hypotheses',
				fill: ontologyFillForKey('idea')
			}
		]
	},
	{
		title: 'Your ontology: relation kinds',
		items: [
			{ key: 'onto-rel-blocks', label: 'blocks', hint: 'Task → Reference' },
			{ key: 'onto-rel-owns', label: 'owns', hint: 'Person → Task' },
			{ key: 'onto-rel-mentions', label: 'mentions', hint: 'Capture → Entity' }
		]
	}
];

export const DEMO_GRAPH_NODES = [
	{ id: 'e-capture', kind: 'Entity' as const, label: 'Migration follow-up', subtype: 'task' },
	{ id: 'e-blockers', kind: 'Entity' as const, label: 'Migration blockers', subtype: 'reference' },
	{ id: 'e-alex', kind: 'Entity' as const, label: 'Alex', subtype: 'person' },
	{ id: 'e-cutover', kind: 'Entity' as const, label: 'Phase-two cutover', subtype: 'task' },
	{ id: 'e-april', kind: 'Entity' as const, label: 'Early April', subtype: 'reference' },
	{ id: 'e-db', kind: 'Entity' as const, label: 'Database migration', subtype: 'reference' },
	{ id: 'e-infra', kind: 'Entity' as const, label: 'Infra team', subtype: 'person' },
	{ id: 'e-q3', kind: 'Entity' as const, label: 'Q3 planning', subtype: 'idea' }
];

export const DEMO_GRAPH_EDGES = [
	{ id: 'ed-1', sourceId: 'e-capture', targetId: 'e-blockers', relationType: 'mentions', kind: 'mention' },
	{ id: 'ed-2', sourceId: 'e-alex', targetId: 'e-capture', relationType: 'owns', kind: 'entity_relation' },
	{ id: 'ed-3', sourceId: 'e-capture', targetId: 'e-alex', relationType: 'mentions', kind: 'mention' },
	{ id: 'ed-4', sourceId: 'e-blockers', targetId: 'e-cutover', relationType: 'blocks', kind: 'entity_relation' },
	{ id: 'ed-5', sourceId: 'e-blockers', targetId: 'e-db', relationType: 'related_to', kind: 'entity_relation' },
	{ id: 'ed-6', sourceId: 'e-capture', targetId: 'e-april', relationType: 'due_by', kind: 'entity_relation' },
	{ id: 'ed-7', sourceId: 'e-infra', targetId: 'e-db', relationType: 'owns', kind: 'entity_relation' },
	{ id: 'ed-8', sourceId: 'e-q3', targetId: 'e-cutover', relationType: 'includes', kind: 'entity_relation' },
	{ id: 'ed-9', sourceId: 'e-alex', targetId: 'e-april', relationType: 'mentions', kind: 'mention' },
	{ id: 'ed-10', sourceId: 'e-infra', targetId: 'e-blockers', relationType: 'mentions', kind: 'mention' }
];

export const DEMO_CHAT_QUESTION = 'When is the Alex follow-up?';

export const DEMO_ANSWER_QUESTION_PREVIEW = JSON.stringify({
	answer: 'Answer: Early April — you captured a follow-up with Alex on migration blockers.',
	retrieved: [
		{
			id: 'th_demo_018f4a',
			normalizedText: 'Follow up with Alex on migration blockers by early April.',
			category: 'task'
		}
	]
});

export const DEMO_TEMPORAL_EVENTS: TemporalEventListItem[] = [
	{
		id: 'te-1',
		kind: 'inferred_event',
		semanticSummary: 'Capture recorded',
		sourceTextSpan: 'customer sync',
		timePrecision: 'day',
		timezone: 'UTC',
		isAllDay: true,
		confidence: 0.92,
		startAt: '2025-03-18T00:00:00.000Z',
		endAt: null,
		activePeriod: 'past',
		graphSyncStatus: 'synced',
		graphSyncError: null,
		thoughtId: 'th_demo_018f4a',
		thoughtText: DEMO_CAPTURE_TEXT,
		createdAt: '2025-03-18T14:22:00.000Z'
	},
	{
		id: 'te-2',
		kind: 'deadline',
		semanticSummary: 'Alex follow-up',
		sourceTextSpan: 'due early April',
		timePrecision: 'day',
		timezone: 'UTC',
		isAllDay: true,
		confidence: 0.88,
		startAt: '2025-04-02T00:00:00.000Z',
		endAt: null,
		activePeriod: 'upcoming',
		graphSyncStatus: 'synced',
		graphSyncError: null,
		thoughtId: 'th_demo_018f4a',
		thoughtText: DEMO_CAPTURE_TEXT,
		createdAt: '2025-03-18T14:22:00.000Z'
	},
];

function pipelineSlotEvent(slot: CaptureIngestPhase | CaptureIngestPhase[]): ProgressEvent {
	if (Array.isArray(slot)) return { parallel: true, phases: slot };
	return { parallel: false, phase: slot };
}

/** Map scroll segment [0,1] to ingest progress events for IngestPhaseIndicator. */
export function demoIngestEventsForProgress(
	progress: number,
	startMs = 1_700_000_000_000
): Array<{ event: ProgressEvent; arrivedAt: number }> {
	const clamped = Math.min(1, Math.max(0, progress));
	const slotCount = CAPTURE_PIPELINE.length;
	const activeIndex = Math.min(slotCount - 1, Math.floor(clamped * slotCount));
	const events: Array<{ event: ProgressEvent; arrivedAt: number }> = [];
	for (let i = 0; i <= activeIndex; i += 1) {
		events.push({
			event: pipelineSlotEvent(CAPTURE_PIPELINE[i]!),
			arrivedAt: startMs + i * 900
		});
	}
	return events;
}
