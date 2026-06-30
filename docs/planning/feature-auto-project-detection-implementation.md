# Automatic Project Detection - Implementation Summary

## What Was Implemented

### 1. Project Detection During Enrichment (`detect-project-from-thought.ts`)

A new module that analyzes thought content to detect multi-step projects:

- **LLM-based detection**: Uses the LLM to analyze if a thought describes a multi-step initiative
- **High confidence threshold**: Only creates projects when confidence >= 0.85
- **Evidence storage**: Stores evidence for why the project was detected
- **Deduplication**: Checks for similar existing projects before creating

Key features:
```typescript
export async function detectAndCreateProjectFromThought(input: {
  userId: string;
  normalizedText: string;
  memoryType: string | null;
  category: string;
}): Promise<string | null>
```

### 2. Integration into Enrichment Pipeline (`enrich.ts`)

Added project detection as a new phase in the enrichment pipeline:
- Runs after GTD assignment
- Catches and logs errors without failing the entire enrichment
- Uses the existing `ingestTimer` for performance tracking

### 3. Database Schema Update (`brain.schema.ts`)

Added 'dismissed' status to ProjectStatus:
```typescript
export const projectStatusValues = ['active', 'someday', 'completed', 'dismissed'] as const;
```

### 4. Project List Updates (`project-list.ts`)

- **Dismiss function**: `dismissProject(userId, entityId)` - sets status to 'dismissed'
- **Filtered list**: `listProjectsForUser` now only returns active projects (excludes dismissed)

### 5. Dismiss API Endpoint (`/api/timeline/projects/[entityId]/dismiss`)

New POST endpoint to dismiss a project:
- Validates user authentication
- Calls `dismissProject` function
- Returns success/error response

### 6. UI Updates (`TemporalEventsProjectsView.svelte`)

- Added dismiss button (X icon) on active projects
- Added status label for dismissed projects
- Dismiss button calls the API and refreshes the list

### 7. Ingest Phases Update (`ingest-phases.ts`)

Added `project_detection` phase with UI copy:
```typescript
project_detection: {
  title: 'Detecting projects',
  description: 'Analyzing if this thought describes a multi-step project or initiative.'
}
```

## How It Works

### Detection Flow

1. User captures a thought
2. During enrichment, after entity extraction and metadata classification:
   - System analyzes thought content with LLM
   - LLM returns: `detected`, `projectLabel`, `confidence`, `evidence`
3. If `detected=true` AND `confidence >= 0.85`:
   - Check for similar existing projects (deduplication)
   - If no similar project exists:
     - Create entity in graph
     - Promote to GTD project
     - Create project profile
     - Log detection for audit

### Dismissal Flow

1. User sees project in projects view
2. User clicks dismiss button (X icon)
3. API sets project status to 'dismissed'
4. Project no longer appears in active projects list
5. Project remains in database for audit purposes

## Key Design Decisions

### Why Confidence Threshold of 0.85?

- **Precision over recall**: Better to miss some projects than create false positives
- **User trust**: Users should trust that detected projects are real
- **Evidence-based**: Only projects with clear multi-step indicators are detected

### Why Not Prompt the User?

- **System confidence**: The system should be confident enough to decide
- **No friction**: User doesn't need to confirm every detection
- **Easy dismissal**: If wrong, user can dismiss with one click

### Why Store Evidence?

- **Audit trail**: Understand why projects were created
- **Debugging**: Help improve detection over time
- **Transparency**: User can see why a project was detected

## Testing Recommendations

### Unit Tests

1. **Detection confidence scoring**
   - Test with explicit project descriptions (high confidence)
   - Test with single tasks (low confidence)
   - Test with ambiguous descriptions

2. **Deduplication logic**
   - Test exact name matches
   - Test fuzzy matches (contained names)
   - Test no match (new project)

3. **Dismissal logic**
   - Test dismiss updates status
   - Test dismissed projects not in list
   - Test audit logging

### Integration Tests

1. **Enrichment pipeline**
   - Test project detection runs
   - Test project created when criteria met
   - Test error handling (detection fails, enrichment continues)

2. **API endpoint**
   - Test dismiss requires authentication
   - Test dismiss updates database
   - Test invalid entityId handling

### E2E Tests

1. **Full detection flow**
   - Capture thought with project description
   - Verify project appears in projects view
   - Verify evidence is stored

2. **Dismissal flow**
   - Dismiss a project
   - Verify it disappears
   - Verify it doesn't reappear

## Metrics to Track

1. **Detection rate**: % of thoughts that trigger detection
2. **Creation rate**: % of detected thoughts that become projects
3. **Dismissal rate**: % of created projects that are dismissed
4. **Precision**: % of created projects that users keep
5. **Latency**: Additional time for project detection

## Future Enhancements

1. **Retroactive detection**: Re-process existing thoughts
2. **Project merging**: Merge similar projects
3. **Confidence tuning**: Adjust threshold based on user behavior
4. **Evidence UI**: Show evidence to users in project details
