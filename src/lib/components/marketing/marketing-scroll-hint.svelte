<script lang="ts">
	type Props = {
		visible?: boolean;
	};

	let { visible = true }: Props = $props();
</script>

<div
	class="pointer-events-none flex flex-col items-center gap-2 transition-opacity duration-500 {visible
		? 'opacity-70'
		: 'opacity-0'}"
	aria-hidden={!visible}
>
	<div
		class="relative flex h-9 w-5 items-start justify-center rounded-full border-2 border-foreground/50 pt-1.5"
	>
		<div class="marketing-scroll-wheel h-0.5 w-0.5 rounded-[1px] bg-foreground/70"></div>
	</div>
	<span class="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Scroll</span>
</div>

<style>
	@keyframes marketing-scroll-wheel {
		0% {
			transform: translateY(0);
			opacity: 1;
		}
		70% {
			transform: translateY(10px);
			opacity: 0;
		}
		71% {
			transform: translateY(0);
			opacity: 0;
		}
		100% {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.marketing-scroll-wheel {
		animation: marketing-scroll-wheel 1.6s ease-in-out infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		.marketing-scroll-wheel {
			animation: none;
			opacity: 0.7;
		}
	}
</style>
