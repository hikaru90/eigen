# Layered Evaluation System

Human-in-the-loop evaluation of each ingest layer quality.

## Quick Start

1. **View evaluations**: Visit `/eval` in dev mode
2. **Run evaluation**: Click "Run Evaluation" or run:
   ```bash
   npm run eval:layer:all
   ```

## Layers

### Embedding (`npm run eval:layer:embedding`)
- Evaluates: Retrieval quality via cosine similarity
- Metrics: Avg/min/max similarity, neighbor rankings
- Time: ~30s
- LLM calls: Yes (for embedding generation)

### Relations (`npm run eval:layer:relations`)
- Evaluates: Thought-to-thought relation extraction
- Metrics: Precision, Recall, F1
- **Human judgment required**: Review false positives/negatives in UI
- Time: ~10s
- LLM calls: No (uses cached)

### Entities (`npm run eval:layer:entities`)
- Evaluates: Entity mention and triple extraction
- Metrics: Precision, Recall, F1
- **Human judgment required**: Review false positives/negatives
- Time: ~10s
- LLM calls: No (uses cached)

### Communities (`npm run eval:layer:communities`)
- Evaluates: Community detection quality
- Metrics: Entity count, community count, modularity
- **Visual inspection**: Check community visualization
- Time: ~5s
- LLM calls: No

## Golden Dataset

File: `evals/golden/dataset.yaml`

Contains 10 human-representative thoughts with expected:
- Categories
- Entities (surface + type)
- Relations (thought-to-thought)

### Labeling Workflow

1. Edit `dataset.yaml` to add expected outputs
2. Run eval to see comparison
3. Iterate on ground truth

## Reports

Generated in `evals/reports/`:
- `layer-embedding-{timestamp}.json`
- `layer-relations-{timestamp}.json`
- `layer-entities-{timestamp}.json`
- `layer-communities-{timestamp}.json`
- `layer-all-{timestamp}.json` (combined)

## Visual Inspection (`/eval`)

Dev-only route with tabs:
- **Embedding**: Similarity metrics
- **Relations**: Per-thought comparison + judgment UI
- **Entities**: Per-thought comparison + judgment UI
- **Communities**: Community list + metrics
- **History**: All past runs

### Judgment UI

For relations and entities:
- ✓ Correct
- ✗ False Positive
- ✗ False Negative
- ? Needs Review

Judgments are stored per-run for analysis.

## Comparison to Existing Evals

| Eval | Scope | Speed | Human Judgment |
|------|-------|-------|----------------|
| `eval:agent` | End-to-end | ~5min | Indirect (LLM judge) |
| `eval:layer:*` | Per-layer | ~10s | Direct (your judgment) |

Use both:
- Layer evals: Deep inspection, during development
- Agent eval: Release gating, regression testing
