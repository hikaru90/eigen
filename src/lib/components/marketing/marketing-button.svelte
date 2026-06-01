<script lang="ts">
	import { Button, type ButtonProps } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	type Surface = 'light' | 'dark';

	type Props = ButtonProps & {
		/** `light` = white/sage page bands; `dark` = black enterprise/footer bands */
		surface?: Surface;
	};

	let {
		surface = 'light',
		variant = 'default',
		class: className,
		children,
		...rest
	}: Props = $props();

	const surfaceStyles: Record<Surface, Partial<Record<NonNullable<ButtonProps['variant']>, string>>> = {
		light: {
			default:
				'!border-2 !border-black !bg-black !text-white shadow-[3px_3px_0_0_#000] hover:!bg-black/85 hover:!text-white',
			outline:
				'!border-2 !border-black !bg-white !text-black shadow-[3px_3px_0_0_#000] hover:!bg-[#f0f3f0] hover:!text-black',
			secondary:
				'!border-2 !border-black !bg-[#f0f3f0] !text-black shadow-[3px_3px_0_0_#000] hover:!bg-[#e8ede5] hover:!text-black',
			ghost: '!text-black hover:!bg-black/5 hover:!text-black',
			link: '!text-black underline-offset-4'
		},
		dark: {
			default:
				'!border-2 !border-white/50 !bg-white !text-black hover:!bg-white/90 hover:!text-black',
			outline:
				'!border-2 !border-white/50 !bg-transparent !text-white hover:!bg-white/10 hover:!text-white',
			secondary:
				'!border-2 !border-white/50 !bg-white !text-black hover:!bg-white/90 hover:!text-black',
			ghost: '!text-white hover:!bg-white/10 hover:!text-white',
			link: '!text-white underline-offset-4'
		}
	};

	const marketingClass = $derived(
		surfaceStyles[surface][variant ?? 'default'] ?? surfaceStyles[surface].default
	);
</script>

<Button {variant} class={cn(marketingClass, className)} {...rest}>
	{@render children?.()}
</Button>
