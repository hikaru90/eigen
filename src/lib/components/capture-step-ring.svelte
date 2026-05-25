<script lang="ts">
	interface Props {
		/** Total pipeline slots (sequential + parallel groups count as one each). */
		total: number;
		/** Number of completed slots (0 … total). */
		completed: number;
		/** When true, the active slot pulses while in progress. */
		active?: boolean;
		size?: number;
	}

	let { total, completed, active = false, size = 36 }: Props = $props();

	const stepDeg = $derived(total > 0 ? 360 / total : 360);
	const ringStyle = $derived.by(() => {
		if (total <= 0) return 'background: #e5e5e5';
		const stops: string[] = [];
		for (let i = 0; i < total; i++) {
			const start = i * stepDeg;
			const end = (i + 1) * stepDeg;
			let color = '#e5e5e5';
			if (i < completed) color = '#000000';
			else if (i === completed && active) color = '#000000';
			stops.push(`${color} ${start}deg ${end}deg`);
		}
		return `conic-gradient(from -90deg, ${stops.join(', ')})`;
	});
</script>

<div
	class="shrink-0 rounded-full {active ? 'animate-pulse' : ''}"
	style="width: {size}px; height: {size}px; background: {ringStyle}; mask: radial-gradient(circle, transparent 52%, black 53%); -webkit-mask: radial-gradient(circle, transparent 52%, black 53%);"
	role="img"
	aria-hidden="true"
></div>
