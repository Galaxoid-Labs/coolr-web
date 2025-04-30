<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { formatDate, linkify, validChannelName } from '$lib';

	import { SimplePool } from 'nostr-tools/pool';
	import type { Event, EventTemplate } from 'nostr-tools';
	import { nprofileEncode } from 'nostr-tools/nip19';

	let nostrPublicKey = $state('');
	let messages = $state<Map<string, Event[]>>(new Map());
	let channels = $state(['#']); // default channel

	let metadata = $state<Map<string, ProfileInfo>>(new Map());
	let verified = $state<string[]>([]);

	let selectedChannel = $state('#');
	let showSidebar = $state(true);
	let autoScroll = $state(true);

	let input = $state('');
	let inputEl = $state({} as HTMLInputElement);
	let chatContainer: HTMLDivElement;

	let relayUrl = $state('wss://relay.damus.io');
	const METADATA_RELAY_URL = 'wss://purplepag.es';
	const CHAT_KIND = 23333; // kind for channel messages: TBD
	let pool: SimplePool;

	onMount(() => {
		if (!browser) return;

		// Need to setup versioning so I can clear localStorage if needed.
		const version = localStorage.getItem('version');
		if (version !== '2') {
			localStorage.clear();
			localStorage.setItem('version', '2');
		}

		// load stored relay URL
		const storedRelayUrl = localStorage.getItem('relayUrl');
		if (storedRelayUrl) {
			relayUrl = storedRelayUrl;
		} else {
			localStorage.setItem('relayUrl', 'wss://relay.damus.io');
		}

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

		const rawVerified = localStorage.getItem('verified');
		if (rawVerified) {
			try {
				const parsed = JSON.parse(rawVerified) as string[];
				verified = parsed;
			} catch (e) {
				console.error('Failed to parse verified:', e);
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

		setTimeout(() => {
			if ((messages.get(selectedChannel) ?? []).length > 0) {
				scrollToBottom();
				subscribeMetadata();
			}
		}, 0); // Wait for DOM to update
	});

	$effect(() => {
		if (!browser) return;

		localStorage.setItem('relayUrl', relayUrl);

		const serialized = JSON.stringify(Object.fromEntries(messages));
		localStorage.setItem('messages', serialized);

		const serializedMetadata = JSON.stringify(Object.fromEntries(metadata));
		localStorage.setItem('metadata', serializedMetadata);

		const serializedVerified = JSON.stringify(verified);
		localStorage.setItem('verified', serializedVerified);

		localStorage.setItem('channels', JSON.stringify(channels));
		localStorage.setItem('selectedChannel', selectedChannel);
		localStorage.setItem('nostrPublicKey', nostrPublicKey);

		if (autoScroll && messages.size > 0) {
			if ((messages.get(selectedChannel) ?? []).length > 0) {
				scrollToBottom();
			}
			setTimeout(() => {
				inputEl?.focus();
			}, 0);
		}
	});

	async function login() {
		if (!browser) return;
		if (window.nostr) {
			try {
				nostrPublicKey = await window.nostr.getPublicKey();
				subscribeMetadata();
				console.log('Logged in with Nostr public key:', nostrPublicKey);
			} catch (error) {
				console.error('Error logging in with Nostr:', error);
			}
		} else {
			console.error('Nostr is not available');
		}
	}

	async function verifyNip05(nip05: string, pubkey: string) {
		if (!browser) return;
		if (nip05.includes('bitcoinbarks.com')) {
			// TODO: Temporary since CORS issue with bitcoinbarks.com
			return;
		}

		try {
			const domain = nip05.split('@')[1];
			const response = await fetch(`https://${domain}/.well-known/nostr.json`);
			if (response.ok) {
				const data = await response.json();
				if (data.names) {
					const name = nip05.split('@')[0];
					const pubkeyFromName = data.names[name];
					if (pubkeyFromName === pubkey && !verified.includes(pubkey)) {
						verified.push(pubkey);
					}
				}
			}
		} catch (error) {
			console.log('Error verifying NIP-05:', error);
		}
	}

	function connectToRelay() {
		if (!browser) return;
		if (!pool) return;
		pool.subscribe(
			[relayUrl],
			{
				kinds: [CHAT_KIND],
				limit: 1
			},
			{
				onevent(event: Event) {
					event.created_at = Math.floor(Date.now() / 1000); // Doing this since event created_at not really reliable

					const channelTag = event.tags.find((tag) => tag[0] === 'd');
					if (validChannelName(channelTag?.[1] ?? '')) {
						let channel = channelTag ? channelTag[1] : '';
						channel = '#' + channel; // ensure it starts with a slash

						addMessageToChannel(channel, event);
						subscribeMetadata();
					}
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

		// lets add current nostr pubkey to the list
		if (nostrPublicKey && !pubkeys.includes(nostrPublicKey)) {
			pubkeys.push(nostrPublicKey);
		}

		// check if new pubkeys are in metadata map
		const newPubkeys = pubkeys.filter((pubkey) => !metadata.has(pubkey));
		if (newPubkeys.length === 0) return; // No new pubkeys to subscribe to

		pool.subscribe(
			[METADATA_RELAY_URL, relayUrl],
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

					const nip05 = (content as { nip05?: string }).nip05;
					let profile: ProfileInfo = {
						pubkey: pubkey
					};

					if (nip05) {
						profile.nip05 = nip05;
						const current = metadata.get(pubkey) ?? null;
						if (current) {
							metadata.set(pubkey, { ...current, ...profile });
						} else {
							metadata.set(pubkey, profile);
						}

						const newMap = new Map(metadata);
						metadata = newMap;

						if (!verified.includes(pubkey)) {
							verifyNip05(nip05, pubkey);
						}
					}
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
		const name = prompt('Enter a new channel name (no # only letters and numbers):');
		if (!name) return;

		// const clean = name
		// 	.trim()
		// 	.replace(/\s+/g, '') // Replace spaces with dashes
		// 	.replaceAll('/', '') // Remove any slashes
		// 	.replaceAll('#', '') // Remove any hashes
		// 	.toLowerCase();

		if (!validChannelName(name)) {
			alert(
				'Invalid channel name. Please use only alphanumeric characters. And 12 characters max.'
			);
			return;
		}

		const channel = '#' + name;

		if (!channels.includes(channel)) {
			channels = [...channels, channel];
			selectedChannel = channel;
		}
	}

	function sendMessage() {
		if (!input.trim()) return;
		if (!window.nostr) return;

		// remove "#" from selectedChannel
		let channel = selectedChannel.replace('#', '');
		let tag: string[][] = [];
		if (channel !== '' && validChannelName(channel)) {
			tag = [['d', channel]];
		}
		const event: EventTemplate = {
			kind: CHAT_KIND,
			tags: tag,
			content: input,
			created_at: Math.floor(Date.now() / 1000)
		};

		window.nostr?.signEvent(event).then(async (signedEvent: Event) => {
			await Promise.any(pool.publish([relayUrl], signedEvent));
		});

		input = '';
	}

	function openPubkeyProfile(pubkey: string) {
		if (!browser) return;
		const nprofile = nprofileEncode({ pubkey });
		const url = `https://nosta.me/${nprofile}`;
		window.open(url, '_blank');
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

	function changeRelayUrl() {
		const newRelayUrl = prompt('Enter new relay URL:', relayUrl);
		if (newRelayUrl) {
			// clear messages and channels
			messages = new Map();
			channels = ['#'];
			selectedChannel = '#';

			// disconnect and reconnect to the new relay
			pool.close([relayUrl]);

			relayUrl = newRelayUrl;

			console.log('Relay URL updated to:', relayUrl);
			connectToRelay();
		}
	}
</script>

<!-- Main Layout -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
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
						class="cursor-pointer px-2 py-1 text-cyan-100 hover:bg-cyan-700 hover:text-black {channel ===
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
					<span class="text-cyan-100"> {selectedChannel} </span> |
					<span class="cursor-pointer text-purple-300 hover:underline" onclick={changeRelayUrl}
						>{relayUrl}</span
					>
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
							{#if verified.includes(event.pubkey)}
								<span
									class="cursor-pointer text-cyan-300 hover:underline"
									onclick={() => openPubkeyProfile(event.pubkey)}
									>[ <strong
										>{metadata.get(event.pubkey)?.nip05 || event.pubkey.slice(0, 12)}</strong
									>
									] [
									<span class="text-green-300">✓</span> ]</span
								>
							{:else}
								<span
									class="cursor-pointer text-cyan-300 hover:underline"
									onclick={() => openPubkeyProfile(event.pubkey)}
									>[ <strong
										>{metadata.get(event.pubkey)?.nip05 || event.pubkey.slice(0, 12)}</strong
									>
									] [
									<span class="text-gray-300">-</span> ]</span
								>
							{/if}
							<span class="text-yellow-100"> [ {formatDate(event.created_at)} ]</span>
							<span class="text-gray-100"><strong>{@html linkify(event.content)}</strong></span>
						{:else}
							{#if verified.includes(event.pubkey)}
								<span
									class="cursor-pointer text-cyan-600 hover:underline"
									onclick={() => openPubkeyProfile(event.pubkey)}
									>[ {metadata.get(event.pubkey)?.nip05 || event.pubkey.slice(0, 12)} ] [
									<span class="text-green-300">✓</span> ]</span
								>
							{:else}
								<span
									class="cursor-pointer text-cyan-600 hover:underline"
									onclick={() => openPubkeyProfile(event.pubkey)}
									>[ {metadata.get(event.pubkey)?.nip05 || event.pubkey.slice(0, 12)} ] [
									<span class="text-gray-300">-</span> ]</span
								>
							{/if}
							<span class="text-yellow-100"> [ {formatDate(event.created_at)} ]</span>
							<span class="text-gray-300">{@html linkify(event.content)}</span>
						{/if}
					</div>
				{/each}
			{:else}
				<div class="text-cyan-50">No messages yet...</div>
			{/if}
		</div>

		<!-- Input Bar -->
		<form class="flex border-t border-cyan-700 p-2" onsubmit={sendMessage}>
			<input
				type="text"
				bind:this={inputEl}
				bind:value={input}
				placeholder="Type a message..."
				class="flex-1 border-none bg-gray-900 px-2 text-cyan-100 focus:outline-none"
				autocomplete="off"
			/>
			<button
				type="submit"
				class="ml-2 rounded bg-cyan-600 px-3 py-1 font-bold text-black hover:bg-cyan-700"
			>
				Send
			</button>
		</form>
	</div>
</div>
