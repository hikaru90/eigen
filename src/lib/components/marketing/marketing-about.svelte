<script lang="ts">
	import { marketingReveal } from '$lib/actions/marketing-reveal';
</script>

<section class="relative mb-20 md:mb-32">
	<div class="grid gap-10 lg:grid-cols-2 lg:items-center">
		<div>
			<p
				use:marketingReveal
				class="text-primary mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-6 opacity-0"
			>
				About
			</p>
			<h2
				use:marketingReveal
				class="text-foreground mb-6 text-2xl font-semibold tracking-tight transition-all duration-700 is-visible:translate-y-0 is-visible:opacity-100 translate-y-8 opacity-0 sm:text-3xl"
			>
				Memory that works the way you think
			</h2>
			<p
				use:marketingReveal
				class="text-muted-foreground mb-4 text-sm leading-relaxed transition-opacity duration-700 is-visible:opacity-100 opacity-0"
			>
				Eigen Mesh is for people who jot ideas in many places and want one place that remembers them
				— not another app that makes you sort everything by hand.
			</p>
			<p
				use:marketingReveal
				class="text-muted-foreground mb-4 text-sm leading-relaxed transition-opacity delay-100 duration-700 is-visible:opacity-100 opacity-0"
			>
				Save a thought in plain language. We handle the tidy-up in the background—topics, dates, and
				connections—so you can ask for it later in everyday words.
			</p>
			<p
				use:marketingReveal
				class="text-muted-foreground text-sm leading-relaxed transition-opacity delay-200 duration-700 is-visible:opacity-100 opacity-0"
			>
				Run it on your own computer when you want full control, or use our hosted version. Either way,
				you always know where your data lives.
			</p>
		</div>

		<div
			use:marketingReveal
			class="border-2 border-black bg-card p-6 shadow-[8px_8px_0px_0px_#000] transition-all duration-700 dark:border-border dark:shadow-none is-visible:scale-100 is-visible:opacity-100 scale-95 opacity-0"
		>
			<p class="text-primary mb-2 text-[11px] font-semibold uppercase tracking-[0.13em]">What you get</p>
			<ul class="text-foreground space-y-2 text-sm">
				<li>Quick capture—no folders or tags required</li>
				<li>Automatic organization in the background</li>
				<li>Clear activity log with every charge listed</li>
				<li>Works with the AI tools you already use</li>
			</ul>
		</div>
	</div>
</section>
