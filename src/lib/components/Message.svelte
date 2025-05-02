<script lang="ts">
	import type { Event } from 'nostr-tools';
	import { npubEncode } from 'nostr-tools/nip19';
	import { formatDate } from '$lib';

	const { nostrPublicKey, event, profileInfo, verified, linkify, openPubkeyProfile } = $props<{
		nostrPublicKey: string;
		event: Event;
		profileInfo: ProfileInfo | undefined;
		verified: boolean;
		linkify: (text: string) => string;
		openPubkeyProfile: (pubkey: string) => void;
	}>();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="break-words break-all whitespace-pre-wrap">
	{#if event.pubkey === nostrPublicKey}
		<span class="text-yellow-100 opacity-30">{formatDate(event.created_at)}</span>
		{#if verified}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-300 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				><strong>&lt;{profileInfo?.name || npubEncode(event.pubkey).slice(0, 12)}&gt;</strong>
				<span class="text-green-300">✓</span>
			</span>
		{:else}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-300 opacity-30 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				>&lt;<strong>{profileInfo?.name || npubEncode(event.pubkey).slice(0, 12)}</strong>
				&gt;</span
			>
		{/if}

		<span class="text-gray-100"><strong>{@html linkify(event.content)}</strong></span>
	{:else}
		<span class="text-yellow-100 opacity-30">{formatDate(event.created_at)}</span>
		{#if verified}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-600 opacity-70 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				>&lt;{profileInfo?.name || npubEncode(event.pubkey).slice(0, 12)}&gt;

				<span class="text-green-300">✓</span>
			</span>
		{:else}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-600 opacity-70 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				>&lt;{profileInfo?.name || npubEncode(event.pubkey).slice(0, 12)}&gt</span
			>
		{/if}

		<span class="text-gray-400">{@html linkify(event.content)}</span>
	{/if}
</div>
