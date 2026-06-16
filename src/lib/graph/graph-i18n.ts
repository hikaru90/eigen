import { COMMUNITY_LEAF_LEVEL } from '$lib/graph/community-levels';
import { m } from '$lib/paraglide/messages.js';
import { getLocale } from '$lib/paraglide/runtime';
const GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE = 'Your ontology: entity kinds';

export { GRAPH_ONTOLOGY_ENTITY_KINDS_TITLE };

export function graphIntlLocale(): string {
	return getLocale() === 'de' ? 'de-DE' : 'en-US';
}

/** German UI uses 24-hour clock; English keeps 12-hour AM/PM. */
export function graphUsesHour12(): boolean {
	return getLocale() !== 'de';
}

export function graphCommunityLevelLabel(level: number): string {
	if (level === COMMUNITY_LEAF_LEVEL) return m.graph_community_l2();
	if (level === 1) return m.graph_community_l1();
	return m.graph_community_l0();
}

export function graphEdgeKindLabel(kind: string): string {
	if (kind === 'all') return m.graph_edge_all();
	if (kind === 'co_mention') return m.graph_edge_co_mention();
	if (kind === 'entity_relation') return m.graph_edge_relations();
	return kind;
}

export function graphKindLabel(kind: string): string {
	switch (kind) {
		case 'deadline':
			return m.graph_temporal_kind_deadline();
		case 'appointment':
			return m.graph_temporal_kind_appointment();
		case 'milestone':
			return m.graph_temporal_kind_milestone();
		case 'period':
			return m.graph_temporal_kind_period();
		case 'reminder':
			return m.graph_temporal_kind_reminder();
		case 'inferred_event':
			return m.graph_temporal_kind_inferred_event();
		default:
			return kind;
	}
}

export function graphAgendaSectionLabel(
	section: 'today' | 'tomorrow' | 'this_week' | 'later' | 'past' | 'unscheduled'
): string {
	switch (section) {
		case 'today':
			return m.graph_temporal_agenda_section_today();
		case 'tomorrow':
			return m.graph_temporal_agenda_section_tomorrow();
		case 'this_week':
			return m.graph_temporal_agenda_section_this_week();
		case 'later':
			return m.graph_temporal_agenda_section_later();
		case 'past':
			return m.graph_temporal_agenda_section_past();
		case 'unscheduled':
			return m.graph_temporal_agenda_section_unscheduled();
	}
}

export function graphTemporalRangeLabel(range: 'relevant' | 'upcoming' | 'past' | 'all'): string {
	switch (range) {
		case 'relevant':
			return m.graph_temporal_range_relevant();
		case 'upcoming':
			return m.graph_temporal_range_upcoming();
		case 'past':
			return m.graph_temporal_range_past();
		case 'all':
			return m.graph_temporal_range_all();
	}
}

export function graphEntitySyncStatusMessage(edgesAdded: number): string {
	if (edgesAdded > 1) return m.graph_status_entity_sync_many({ count: edgesAdded });
	if (edgesAdded === 1) return m.graph_status_entity_sync_one({ count: edgesAdded });
	return m.graph_status_entity_sync_refreshed();
}

export function graphWeekdayLabels(): string[] {
	const fmt = new Intl.DateTimeFormat(graphIntlLocale(), { weekday: 'short' });
	const monday = new Date(2026, 0, 5);
	return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(monday.getTime() + i * 86_400_000)));
}

export function graphMatrixQuadrantLabel(
	quadrant:
		| 'urgent_important'
		| 'not_urgent_important'
		| 'urgent_not_important'
		| 'neither'
		| 'unclassified'
): string {
	switch (quadrant) {
		case 'urgent_important':
			return m.graph_timeline_quadrant_ui();
		case 'not_urgent_important':
			return m.graph_timeline_quadrant_nui();
		case 'urgent_not_important':
			return m.graph_timeline_quadrant_uni();
		case 'neither':
			return m.graph_timeline_quadrant_nn();
		case 'unclassified':
			return m.graph_timeline_quadrant_unclassified();
	}
}

export function graphEnergyLevelLabel(level: string): string {
	switch (level) {
		case 'deep':
			return m.graph_energy_deep();
		case 'medium':
			return m.graph_energy_medium();
		case 'light':
			return m.graph_energy_light();
		default:
			return level;
	}
}
