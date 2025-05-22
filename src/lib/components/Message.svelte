<script lang="ts">
	import type { Event } from 'nostr-tools';
	import { npubEncode } from 'nostr-tools/nip19';
	import { formatDate } from '$lib';
	import DOMPurify from 'dompurify';
	import type { ProfileInfo } from '$lib/db';

	const { nostrPublicKey, event, profileInfo, linkify, openPubkeyProfile } = $props<{
		nostrPublicKey: string;
		event: Event;
		profileInfo: ProfileInfo | undefined;
		linkify: (text: string) => string;
		openPubkeyProfile: (pubkey: string) => void;
	}>();

	const sanitize = (html: string) => {
		return DOMPurify.sanitize(html, {
			ALLOWED_TAGS: ['a', 'span'],
			ALLOWED_ATTR: ['href', 'target', 'rel', 'class']
		});
	};
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="break-words whitespace-pre-wrap">
	{#if event.pubkey === nostrPublicKey}
		<span class="text-yellow-100 opacity-30">{formatDate(event.created_at)}</span>
		{#if profileInfo && profileInfo.verified}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-300 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				><strong
					>&lt;{sanitize(profileInfo?.name || npubEncode(event.pubkey).slice(0, 12))}&gt;</strong
				>
				<span class="text-green-300">✓</span>
			</span>
		{:else}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-300 opacity-30 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				>&lt;<strong>{sanitize(profileInfo?.name || npubEncode(event.pubkey).slice(0, 12))}</strong>
				&gt;</span
			>
		{/if}

		<span class="text-gray-100"><strong>{@html sanitize(linkify(event.content))}</strong></span>
	{:else}
		<span class="text-yellow-100 opacity-30">{formatDate(event.created_at)}</span>
		{#if profileInfo && profileInfo.verified}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-600 opacity-70 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				>&lt;{sanitize(profileInfo?.name || npubEncode(event.pubkey).slice(0, 12))}&gt;

				<span class="text-green-300">✓</span>
			</span>
		{:else}
			<span
				title={profileInfo?.nip05 || event.pubkey}
				class="cursor-pointer text-cyan-600 opacity-70 hover:underline"
				onclick={() => openPubkeyProfile(event.pubkey)}
				>&lt;{sanitize(profileInfo?.name || npubEncode(event.pubkey).slice(0, 12))}&gt</span
			>
		{/if}

		<span class="text-gray-400">{@html sanitize(linkify(event.content))}</span>
	{/if}
</div>
