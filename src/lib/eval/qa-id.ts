const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const FIXTURE_ID_PATTERN = /^ec_[a-z0-9_]+$/;

/** Slug from question text for qa_<slug> ids. */
export function slugifyQuestionForQaId(question: string): string {
	const slug = question
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 48);
	return slug.length > 0 ? slug : 'question';
}

export function validateEvalQaId(id: string): string {
	const trimmed = id.trim();
	if (!ID_PATTERN.test(trimmed)) {
		throw new Error(
			'ID must start with a letter and contain only lowercase letters, digits, and underscores'
		);
	}
	return trimmed;
}

/** Unique qa_* id from question; appends _2, _3, … on collision. */
export function generateEvalQaId(question: string, existingIds: ReadonlySet<string>): string {
	const base = validateEvalQaId(`qa_${slugifyQuestionForQaId(question)}`);
	if (!existingIds.has(base)) return base;
	for (let n = 2; n < 10_000; n += 1) {
		const candidate = validateEvalQaId(`${base}_${n}`);
		if (!existingIds.has(candidate)) return candidate;
	}
	return validateEvalQaId(`qa_${Date.now().toString(36)}`);
}

export function validateFixtureId(id: string): string {
	const trimmed = id.trim();
	if (!FIXTURE_ID_PATTERN.test(trimmed)) {
		throw new Error(
			'Fixture ID must start with ec_ and contain only lowercase letters, digits, and underscores'
		);
	}
	return trimmed;
}

/** Unique ec_<slug> id from capture text; appends _2, _3, … on collision. */
export function generateFixtureId(rawText: string, existingIds: ReadonlySet<string>): string {
	const base = validateFixtureId(`ec_${slugifyQuestionForQaId(rawText)}`);
	if (!existingIds.has(base)) return base;
	for (let n = 2; n < 10_000; n += 1) {
		const candidate = validateFixtureId(`${base}_${n}`);
		if (!existingIds.has(candidate)) return candidate;
	}
	return validateFixtureId(`ec_${Date.now().toString(36)}`);
}

/** Assign fixture IDs to captures missing them; preserves explicit IDs when valid. */
export function assignCaptureFixtureIds(
	captures: Array<{ fixtureId: string; rawText?: string; createdAt?: string }>,
	reservedIds: ReadonlySet<string>
): Array<{ fixtureId: string; rawText: string; createdAt?: string }> {
	const used = new Set(reservedIds);
	const resolved: Array<{ fixtureId: string; rawText: string; createdAt?: string }> = [];

	for (const cap of captures) {
		const rawText = cap.rawText?.trim() ?? '';
		if (!rawText) continue;

		let fixtureId = cap.fixtureId.trim();
		if (fixtureId) {
			fixtureId = validateFixtureId(fixtureId);
		} else {
			fixtureId = generateFixtureId(rawText, used);
		}
		if (used.has(fixtureId)) {
			throw new Error(`Fixture ID already in use: ${fixtureId}`);
		}
		used.add(fixtureId);
		resolved.push({
			fixtureId,
			rawText,
			...(cap.createdAt ? { createdAt: cap.createdAt } : {})
		});
	}

	return resolved;
}
