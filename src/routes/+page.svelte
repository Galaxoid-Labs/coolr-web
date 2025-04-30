<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { formatDate, linkify } from '$lib';

	import { SimplePool } from 'nostr-tools/pool';
	import type { Event, EventTemplate } from 'nostr-tools';

	let nostrPublicKey = $state('');
	let messages = $state<Map<string, Event[]>>(new Map());
	let channels = $state(['/']); // default channel

	let metadata = $state<Map<string, ProfileInfo>>(new Map());

	let selectedChannel = $state('/');
	let showSidebar = $state(true);

	let input = $state('');
	let inputEl = $state({} as HTMLInputElement);
	let chatContainer: HTMLDivElement;
	let autoScroll = true;

	const RELAY_URL = 'wss://relay.damus.io';
	const METADAT_RELAY_URL = 'wss://purplepag.es';
	const CHAT_KIND = 23333; // kind for channel messages: TBD
	let pool: SimplePool;

	onMount(() => {
		if (!browser) return;
		pool = new SimplePool();
		connectToRelay();

		const currentNostrPublicKey = localStorage.getItem('nostrPublicKey');
		if (currentNostrPublicKey) {
			nostrPublicKey = currentNostrPublicKey;
		}

		const rawMessages = localStorage.getItem('messages');
		if (rawMessages) {
			try {
				const parsed = JSON.parse(rawMessages) as Record<string, Event[]>;
				messages = new Map(Object.entries(parsed));
			} catch (e) {
				console.error('Failed to parse messages:', e);
			}
		}

		const rawMetadata = localStorage.getItem('metadata');
		if (rawMetadata) {
			try {
				const parsed = JSON.parse(rawMetadata) as Record<string, ProfileInfo>;
				metadata = new Map(Object.entries(parsed));
			} catch (e) {
				console.error('Failed to parse metadata:', e);
			}
		}

		const rawChannels = localStorage.getItem('channels');
		if (rawChannels) {
			try {
				channels = JSON.parse(rawChannels);
			} catch (e) {
				console.error('Failed to parse channels:', e);
			}
		}

		const currentSelectedChannel = localStorage.getItem('selectedChannel');
		if (currentSelectedChannel) {
			selectedChannel = currentSelectedChannel;
		}
	});

	$effect(() => {
		if (!browser) return;
		const serialized = JSON.stringify(Object.fromEntries(messages));
		localStorage.setItem('messages', serialized);

		const serializedMetadata = JSON.stringify(Object.fromEntries(metadata));
		localStorage.setItem('metadata', serializedMetadata);

		localStorage.setItem('channels', JSON.stringify(channels));
		localStorage.setItem('selectedChannel', selectedChannel);
		localStorage.setItem('nostrPublicKey', nostrPublicKey);
	});

	async function login() {
		if (!browser) return;
		if (window.nostr) {
			try {
				nostrPublicKey = await window.nostr.getPublicKey();
				console.log('Logged in with Nostr public key:', nostrPublicKey);
			} catch (error) {
				console.error('Error logging in with Nostr:', error);
			}
		} else {
			console.error('Nostr is not available');
		}
	}

	function connectToRelay() {
		if (!browser) return;
		if (!pool) return;
		pool.subscribe(
			[RELAY_URL],
			{
				kinds: [CHAT_KIND],
				limit: 1
			},
			{
				onevent(event: Event) {
					event.created_at = Math.floor(Date.now() / 1000); // Doing this since event created_at not really reliable

					const channelTag = event.tags.find((tag) => tag[0] === 'd');
					let channel = channelTag ? channelTag[1] : '/';
					channel = '/' + channel; // ensure it starts with a slash

					addMessageToChannel(channel, event);
					subscribeMetadata();
				},
				onclose(reasons: string[]) {
					console.log('Connection closed:', reasons);
					// TODO: Not sure if this is best way to handle disconnects??
					setTimeout(() => {
						console.log('Reconnecting...');
						connectToRelay();
					}, 5000);
				}
			}
		);
	}

	function subscribeMetadata() {
		if (!browser) return;
		if (!pool) return;

		// get unique pubkeys from messages
		const pubkeys = Array.from(messages.values())
			.flat()
			.map((event) => event.pubkey)
			.filter((value, index, self) => self.indexOf(value) === index);
		//console.log('Subscribing to metadata for pubkeys:', pubkeys);

		pool.subscribe(
			[METADAT_RELAY_URL],
			{
				kinds: [0],
				authors: pubkeys
			},
			{
				id: 'metadata',
				onevent(event: Event) {
					const pubkey = event.pubkey;

					let content: string;
					try {
						content = JSON.parse(event.content);
					} catch (e) {
						console.error('Error parsing metadata content:', e);
						return;
					}
					if (!content) return;

					const profile: ProfileInfo = {
						pubkey: pubkey,
						nip05: (content as { nip05?: string }).nip05 || event.pubkey
					};
					// Update the metadata map
					const current = metadata.get(pubkey) ?? null;
					if (current) {
						metadata.set(pubkey, { ...current, ...profile });
					} else {
						metadata.set(pubkey, profile);
					}
					// Trigger reactivity by replacing the Map
					const newMap = new Map(metadata);
					metadata = newMap;
				}
			}
		);
	}

	function addMessageToChannel(channel: string, event: Event) {
		if (!channels.includes(channel)) {
			channels = [...channels, channel];
		}

		const current = messages.get(channel) ?? [];

		if (current.some((msg) => msg.id === event.id)) {
			return; // Ignore duplicate messages
		}

		const updated = [...current, event];

		// Trim from the front if over limit
		const MAX_MESSAGES = 500; // Maximum number of messages to keep per channel
		const limited = updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;

		// Trigger reactivity by replacing the Map
		const newMap = new Map(messages);
		newMap.set(channel, limited);
		messages = newMap;
	}

	function addNewChannel() {
		const name = prompt('Enter a new channel name (no slashes):');
		if (!name) return;

		const clean = name
			.trim()
			.replace(/\s+/g, '-') // Replace spaces with dashes
			.replaceAll('/', '') // Remove any slashes
			.toLowerCase();

		const channel = '/' + clean;

		if (!channels.includes(channel)) {
			channels = [...channels, channel];
			selectedChannel = channel;
		}
	}

	function sendMessage() {
		if (!input.trim()) return;
		if (!window.nostr) return;

		// remove "/" from selectedChannel
		const event: EventTemplate = {
			kind: CHAT_KIND,
			tags: [['d', selectedChannel.replace('/', '')]],
			content: input,
			created_at: Math.floor(Date.now() / 1000)
		};

		window.nostr?.signEvent(event).then(async (signedEvent: Event) => {
			await Promise.any(pool.publish([RELAY_URL], signedEvent));
		});

		input = '';
	}

	function toggleSidebar() {
		showSidebar = !showSidebar;
	}

	function selectChannel(channel: string) {
		selectedChannel = channel;
	}

	function scrollToBottom() {
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}

	function handleScroll() {
		const threshold = 100;
		const atBottom =
			chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < threshold;
		autoScroll = atBottom;
	}
</script>

<!-- Main Layout -->
<div class="flex h-screen bg-gray-900 font-mono text-cyan-400">
	<!-- Sidebar -->
	{#if showSidebar}
		<div class="flex w-48 flex-col border-r border-cyan-700 bg-gray-800">
			<!-- <div class="p-3 border-b border-green-700 text-sm font-bold">Channels</div> -->
			<div class="flex items-center justify-between border-b border-cyan-700 p-3 text-sm font-bold">
				<span>Channels</span>
				<button
					class="text-lg leading-none font-bold text-cyan-400 hover:text-cyan-200"
					onclick={addNewChannel}
					title="Add Channel"
				>
					+
				</button>
			</div>
			<div class="flex-1 overflow-y-auto text-sm">
				{#each channels as channel}
					<div
						class="cursor-pointer px-2 py-1 hover:bg-cyan-700 hover:text-black {channel ===
						selectedChannel
							? 'bg-cyan-700 text-black'
							: ''}"
						onclick={() => selectChannel(channel)}
					>
						{channel}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Chat Area -->
	<div class="flex flex-1 flex-col break-words whitespace-pre-wrap">
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-cyan-700 bg-gray-800 p-2 text-sm">
			<div class="flex items-center gap-2">
				<button
					class="text-lg text-cyan-400 hover:text-cyan-200 focus:outline-none"
					onclick={toggleSidebar}
				>
					&#9776; <!-- Hamburger Icon -->
				</button>
				<span>
					{selectedChannel} |
					<span class="text-purple-300">{RELAY_URL}</span>
					{#if !nostrPublicKey}
						|
						<button class="ml-1 text-red-500 hover:underline" onclick={login}>
							(Login with Extension)
						</button>
					{:else}
						|
						<span class="text-cyan-300">
							({nostrPublicKey.slice(0, 12)}) {metadata.get(nostrPublicKey)?.nip05}
						</span>
					{/if}
				</span>
			</div>
		</div>

		<!-- Chat Messages -->
		<div
			class="flex-1 space-y-1 overflow-x-auto overflow-y-auto p-2 text-sm break-words whitespace-pre-wrap"
			bind:this={chatContainer}
			onscroll={handleScroll}
		>
			<!-- Display messages for the selected channel -->
			{#if messages.has(selectedChannel)}
				{#each messages.get(selectedChannel) ?? [] as event}
					<div class="break-words break-all whitespace-pre-wrap">
						{#if event.pubkey === nostrPublicKey}
							<span class="text-cyan-300"
								>[ {metadata.get(event.pubkey)?.nip05 || event.pubkey.slice(0, 12)} ]</span
							>
						{:else}
							<span class="text-gray-500"
								>[ {metadata.get(event.pubkey)?.nip05 || event.pubkey.slice(0, 12)} ]</span
							>
						{/if}
						<span class="text-yellow-100"> [ {formatDate(event.created_at)} ]</span>
						<span class="text-white">{@html linkify(event.content)}</span>
					</div>
				{/each}
			{:else}
				<div class="text-gray-500">No messages yet...</div>
			{/if}
		</div>

		<!-- Input Bar -->
		<form class="flex border-t border-cyan-700 bg-gray-800 p-2" onsubmit={sendMessage}>
			<input
				type="text"
				bind:this={inputEl}
				bind:value={input}
				placeholder="Type a message..."
				class="flex-1 border-none bg-gray-900 px-2 text-cyan-400 focus:outline-none"
				autocomplete="off"
			/>
			<button
				type="submit"
				class="ml-2 bg-cyan-600 px-3 py-1 font-bold text-black hover:bg-cyan-700"
			>
				Send
			</button>
		</form>
	</div>
</div>
