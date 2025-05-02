<script lang="ts">
	import { formatDate } from '$lib';

	const { event, linkify } = $props<{
		event: SystemEvent;
		linkify: (text: string) => string;
	}>();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="break-words break-all whitespace-pre-wrap">
	<span class="text-yellow-100 opacity-30">{formatDate(event.created_at)}</span>
	<span class="text-orange-300">&lt; <strong>-!-</strong> &gt;</span>
	{#if event.type === 'help'}
		<span class="text-gray-100"><strong>{event.content}</strong></span>
	{:else}
		<span class="text-gray-100"><strong>{@html linkify(event.content)}</strong></span>
	{/if}
</div>
