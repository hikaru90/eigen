<script lang="ts">
	import { base, resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
	import EigenWordmark from '$lib/components/eigen-wordmark.svelte';
	import * as Popover from '$lib/components/ui/popover';

	let menuOpen = $state(false);

	async function signOut() {
		menuOpen = false;
		const res = await fetch(`${base}/api/session/sign-out`, {
			method: 'POST',
			credentials: 'include'
		});
		if (!res.ok) {
			console.error('Sign out failed', res.status, await res.text().catch(() => ''));
			return;
		}
		await goto(resolve('/login'), { invalidateAll: true });
	}
</script>

<header class="w-full px-5 pt-6">
	<div class="mx-auto flex w-full max-w-4xl items-center justify-between">
		<div class="w-10"></div>
		<EigenWordmark heightClass="h-10" />
		<Popover.Root bind:open={menuOpen}>
			<Popover.Trigger
				class="flex size-10 cursor-pointer items-center justify-center rounded-full text-foreground hover:bg-black/5"
				aria-label="Account menu"
			>
				<CircleUserRound class="size-5" />
			</Popover.Trigger>
			<Popover.Content
				align="end"
				side="bottom"
				sideOffset={8}
				class="w-44 rounded-md border border-black/10 bg-card p-1 shadow-md dark:border-white/20"
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
				<button
					type="button"
					class="block w-full rounded-sm px-3 py-2 text-left text-xs text-foreground hover:bg-black/5 dark:hover:bg-white/10"
					onclick={() => void signOut()}
				>
					Log out
				</button>
			</Popover.Content>
		</Popover.Root>
	</div>
</header>
