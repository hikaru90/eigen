# Feature: Automatic Project Detection During Ingest

## Problem Statement

Currently, projects must be created manually by the user. The system has enough context about the user (grounding information, captured thoughts, entity relationships) to automatically detect and create projects with high confidence. However, the current ingestion pipeline does not reliably deduce projects from captured thoughts.

## Goals

1. Automatically detect and create projects during thought ingestion when there is strong evidence
2. Never create projects on a hunch - require high confidence with explicit evidence
3. Make it easy for users to dismiss incorrectly detected projects
4. Leverage existing user context (grounding profile, entity relationships, thought history) for informed detection

## Scope

### In-Scope

- LLM-based project detection during thought enrichment phase
- Evidence-based confidence scoring for project detection
- Automatic project creation when confidence exceeds threshold
- Easy dismiss/disregard mechanism in the projects view
- Project deduplication (don't create duplicate projects for same concept)
- Use of user grounding profile and entity context for detection

### Out-of-Scope

- User prompts or modals to confirm project creation
- Manual project creation UI changes
- Project merging or consolidation features
- Project status management beyond dismiss/disregard
- Retroactive project detection for existing thoughts

## Requirements

### Functional Requirements

1. **FR-1**: During thought enrichment, the system shall analyze the thought for project indicators
2. **FR-2**: The system shall use the following context for detection:
   - User grounding profile (if available)
   - Existing entities and their relationships
   - Thought history and patterns
   - Current projects (to avoid duplicates)
3. **FR-3**: The system shall assign a confidence score (0-1) to detected projects
4. **FR-4**: Projects shall only be created when confidence >= 0.85 (high confidence threshold)
5. **FR-5**: Each detected project must have explicit evidence stored (e.g., "multi-step initiative mentioned in 3+ thoughts", "explicitly described as ongoing work")
6. **FR-6**: Users shall be able to dismiss/disregard a project from the projects view
7. **FR-7**: Dismissed projects shall not reappear unless new strong evidence emerges
8. **FR-8**: The system shall not create duplicate projects for the same concept (deduplication)

### Non-Functional Requirements

1. **NFR-1**: Project detection shall not significantly increase ingestion latency (< 2s additional)
2. **NFR-2**: Detection shall be idempotent (re-processing same thought doesn't create duplicates)
3. **NFR-3**: All project creation decisions shall be logged for audit/debugging

## Acceptance Criteria

### AC-1: High Confidence Project Detection
**Given** a user captures a thought describing a multi-step initiative (e.g., "Working on EigenMesh MVP - need to finish auth, then data layer, then UI")
**When** the thought is enriched
**Then** the system detects "EigenMesh" as a project with confidence >= 0.85
**And** the project is created with evidence: "Multi-step initiative with explicit phases mentioned"

### AC-2: Low Confidence Rejection
**Given** a user captures a thought mentioning a concept (e.g., "Read about React patterns")
**When** the thought is enriched
**Then** the system does NOT create a project for "React patterns"
**And** the thought is stored without project association

### AC-3: Project Deduplication
**Given** a project "EigenMesh" already exists
**When** a new thought mentions "EigenMesh" (e.g., "Fixed a bug in EigenMesh today")
**Then** the system does NOT create a duplicate project
**And** the thought is associated with the existing project

### AC-4: User Dismissal
**Given** a project exists in the projects view
**When** the user clicks "Dismiss" on the project
**Then** the project is marked as dismissed
**And** the project no longer appears in the active projects list
**And** the dismissal is recorded in audit log

### AC-5: Evidence Storage
**Given** a project is detected and created
**When** viewing the project details
**Then** the evidence for detection is visible (e.g., "Detected from 3 thoughts over 2 weeks")
**And** the confidence score is stored (not necessarily displayed to user)

## Risk Classification

**Risk Level: High**

Rationale:
- Incorrect project detection could pollute the user's project list
- Over-aggressive detection could create noise and reduce trust
- Under-aggressive detection could miss important projects
- Balance between precision and recall is critical

## Test Strategy

### Unit Tests

1. **Project detection confidence scoring**
   - Test evidence gathering from thoughts
   - Test confidence calculation logic
   - Test threshold application (>= 0.85)

2. **Deduplication logic**
   - Test similar project name detection
   - Test entity-based deduplication
   - Test fuzzy matching for project names

3. **Dismissal logic**
   - Test dismissal state persistence
   - Test re-emergence prevention
   - Test audit logging

### Integration Tests

1. **Ingestion pipeline integration**
   - Test project detection during enrichment
   - Test project creation in database
   - Test thought-project association

2. **API endpoint tests**
   - Test project dismissal API
   - Test project list with dismissed filter
   - Test audit log queries

### E2E Tests

1. **Full ingestion flow**
   - Capture thought with project indicators
   - Verify project appears in projects view
   - Verify evidence is stored

2. **Dismissal flow**
   - Dismiss a project
   - Verify it disappears from view
   - Capture new thought with same project
   - Verify project does not reappear

## Implementation Plan

### Phase 1: Detection Logic (Core)

1. Add project detection prompt to enrichment pipeline
2. Implement confidence scoring based on evidence
3. Add evidence storage to project entity
4. Implement threshold-based creation logic

### Phase 2: Deduplication

1. Add project name normalization
2. Implement entity-based deduplication
3. Add fuzzy matching for similar names

### Phase 3: User Dismissal

1. Add "dismissed" status to project entity
2. Add dismiss button to projects view
3. Implement dismissal API endpoint
4. Add audit logging for dismissals

### Phase 4: Testing & Hardening

1. Write unit tests for detection logic
2. Write integration tests for pipeline
3. Write E2E tests for user flows
4. Performance testing for ingestion latency

## Open Questions

1. **Confidence threshold**: Is 0.85 the right threshold? Should it be configurable?
2. **Evidence format**: What evidence should be stored? (text summary, source thought IDs, timestamps)
3. **Dismissal permanence**: Should dismissed projects be permanently hidden or show in a "dismissed" filter?
4. **Retroactive detection**: Should we re-process existing thoughts to detect projects? (Out of scope for now, but worth considering)

## Success Metrics

1. **Precision**: % of detected projects that are valid (target: > 90%)
2. **Recall**: % of user-recognized projects that are detected (target: > 70%)
3. **User dismissal rate**: % of detected projects that are dismissed (target: < 20%)
4. **Ingestion latency impact**: Additional time for project detection (target: < 2s)
