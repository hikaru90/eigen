export type LongMemEvalTurn = {
	role: 'user' | 'assistant';
	content: string;
	has_answer?: boolean;
};

export type LongMemEvalInstance = {
	question_id: string;
	question_type: string;
	question: string;
	answer: string;
	question_date: string;
	haystack_dates: string[];
	haystack_session_ids: string[];
	haystack_sessions: LongMemEvalTurn[][];
};

export type LongMemEvalHypothesis = {
	question_id: string;
	hypothesis: string;
};

export type LongMemEvalRunCli = {
	datasetPath: string;
	outputPath: string;
	limit: number | null;
	offset: number;
	resume: boolean;
	runEval: boolean;
	/** Skip generation; only run evaluate_qa.py on --output. */
	scoreOnly: boolean;
	evalMetricModel: string;
	granularity: 'session' | 'turn' | 'user-turn';
};
