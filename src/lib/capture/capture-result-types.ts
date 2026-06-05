export type CaptureLinkedEntity = {
	entityId: string;
	label: string;
	entityType: string;
	mentionSurface: string;
	decision: string;
};

export type CaptureLinkedThought = {
	thoughtId: string;
	relationType: string;
	preview: string;
};

export type CaptureTemporalSummary = {
	id: string;
	kind: string;
	semanticSummary: string;
};

export type CaptureRecentThoughtSnippet = {
	id: string;
	normalizedText: string;
	category: string;
	memoryType: string | null;
	createdAt: string;
};

export type CaptureSubmitResult = {
	id: string;
	normalizedText: string;
	category: string;
	metadata: Record<string, unknown>;
	memoryType: string | null;
	cues: string[];
	enrichedAt: string | null;
	entities: CaptureLinkedEntity[];
	temporalEvents: CaptureTemporalSummary[];
	linkedThoughts: CaptureLinkedThought[];
	enrichmentComplete: boolean;
};
