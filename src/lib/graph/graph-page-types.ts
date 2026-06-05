export type GraphThoughtEditorStored = {
	id: string;
	rawText: string;
	normalizedText: string;
	category: string;
};

export type GraphEntityEditorStored = {
	id: string;
	label: string;
	entityType: string;
	canonicalKey: string;
};

export type EntityCaptureRow = {
	id: string;
	rawText: string;
	normalizedText: string;
	category: string;
	metadata?: Record<string, unknown> | null;
	createdAt: string;
};
