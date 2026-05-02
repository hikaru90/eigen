<script lang="ts">
	import { resolve } from '$app/paths';
	import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
</script>

<header class="w-full px-5 pt-6">
	<div class="mx-auto flex w-full max-w-4xl items-center justify-between">
		<div class="w-10"></div>
		<EigenWordmark heightClass="h-9" />
		<details class="relative">
			<summary
				class="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border border-black/10 bg-card text-foreground hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
				aria-label="Account menu"
			>
				<CircleUserRound class="size-5" />
			</summary>
			<div
				class="absolute right-0 z-20 mt-2 w-44 rounded-md border border-black/10 bg-card p-1 shadow-md dark:border-white/20"
			>
				<a
					href={resolve('/activity')}
					class="block rounded-sm px-3 py-2 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
				>
					Activity
				</a>
				<a
					href={resolve('/settings')}
					class="block rounded-sm px-3 py-2 text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
				>
					Account settings
				</a>
				<form method="post" action={resolve('/api/auth/signout')}>
					<button
						type="submit"
						class="block w-full rounded-sm px-3 py-2 text-left text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
					>
						Log out
					</button>
				</form>
			</div>
		</details>
	</div>
</header>
