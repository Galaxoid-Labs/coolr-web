<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { formatDate, validChannelName, truncateMiddle } from '$lib';
	import { page } from '$app/stores';

	import { SimplePool } from 'nostr-tools/pool';
	import type { Event, EventTemplate } from 'nostr-tools';
	import { nprofileEncode, npubEncode, decodeNostrURI } from 'nostr-tools/nip19';
	import Message from '$lib/components/Message.svelte';
	import SystemMessage from '$lib/components/SystemMessage.svelte';

	let nostrPublicKey = $state('');
	let messages = $state<Map<string, (Event | SystemEvent)[]>>(new Map());
	let channels = $state(['#_']);
	let unreadChannels = $state(['#coolr']);

	let metadata = $state<Map<string, ProfileInfo>>(new Map());
	let verified = $state<string[]>([]);

	let selectedChannel = $state('#_');
	let showSidebar = $state(true);
	let autoScroll = $state(true);

	let input = $state('');
	let chatContainer: HTMLDivElement;

	let relayUrl = $state('wss://relay.damus.io');
	const METADATA_RELAY_URL = 'wss://purplepag.es';
	const CHAT_KIND = 23333; // kind for channel messages: TBD
	let pool: SimplePool;

	onMount(() => {
		if (!browser) return;

		loadCache();

		pool = new SimplePool();
		connectToRelay();

		setTimeout(() => {
			if ((messages.get(selectedChannel) ?? []).length > 0) {
				scrollToBottom();
				subscribeMetadata();
			}
		}, 0); // Wait for DOM to update

		// Used to handle selecting channels from hashtags

		if (typeof window !== 'undefined') {
			(window as any).changeChannel = changeChannel;
		}
	});

	$effect(() => {
		if (!browser) return;

		// const params = $page.url.searchParams;
		// const newRelay = params.get('relay') || relayUrl;
		// const newChannel = $page.url.pathname.split('/').filter(Boolean)[0] || selectedChannel;

		// // if (newRelay !== relayUrl) {
		// // 	relayUrl = newRelay;
		// // 	pool.close([relayUrl]);
		// // 	connectToRelay();
		// // }

		// if (newChannel !== selectedChannel) {
		// 	changeChannel(newChannel);
		// }

		// // Only trigger if something changed
		// if (newRelay !== relayUrl || newChannel !== selectedChannel) {
		// 	//newRelay = newRelay;
		// 	//selectedChannel = newChannel;
		// 	console.log('Relay changed to:', newRelay);
		// 	console.log('Channel changed to:', newChannel);
		// 	//handleRelayChannelChange(relay, channel);
		// }

		saveCache();

		if (autoScroll && messages.size > 0) {
			if ((messages.get(selectedChannel) ?? []).length > 0) {
				scrollToBottom();
			}
		}

		// If any unread channels set document title
		if (unreadChannels.length > 0) {
			document.title = `(${unreadChannels.length}) ${selectedChannel}`;
		} else {
			document.title = `${selectedChannel}`;
		}
	});

	function handlePath() {
		if (!browser) return;
		const params = $page.url.searchParams;
		const newRelay = params.get('relay') || relayUrl;
		const newChannel = $page.url.pathname.split('/').filter(Boolean)[0] || selectedChannel;
		// if (newRelay !== relayUrl) {
		// 	relayUrl = newRelay;
		// 	pool.close([relayUrl]);
		// 	connectToRelay();
		// }

		if (newChannel !== selectedChannel) {
			changeChannel(newChannel);
		}
	}

	function notify(title: string, body: string) {
		if (Notification.permission === 'granted') {
			new Notification(title, { body, icon: '/favicon-32x32.png' });
		} else if (Notification.permission !== 'denied') {
			Notification.requestPermission().then((perm) => {
				if (perm === 'granted') {
					new Notification(title, { body, icon: '/favicon-32x32.png' });
				}
			});
		}
	}

	function loadCache() {
		if (!browser) return;
		const version = localStorage.getItem('version');
		if (version !== '3') {
			localStorage.clear();
			localStorage.setItem('version', '3');
		}

		const storedRelayUrl = localStorage.getItem('relayUrl');
		if (storedRelayUrl) {
			relayUrl = storedRelayUrl;
		} else {
			localStorage.setItem('relayUrl', 'wss://relay.damus.io');
		}

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

		const rawUnreadChannels = localStorage.getItem('unreadChannels');
		if (rawUnreadChannels) {
			try {
				unreadChannels = JSON.parse(rawUnreadChannels);
			} catch (e) {
				console.error('Failed to parse unread channels:', e);
			}
		}

		const currentSelectedChannel = localStorage.getItem('selectedChannel');
		if (currentSelectedChannel) {
			selectChannel(currentSelectedChannel);
		}
	}

	function saveCache() {
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
		localStorage.setItem('unreadChannels', JSON.stringify(unreadChannels));
	}

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
			const response = await fetch(
				`https://${domain}/.well-known/nostr.json?name=${nip05.split('@')[0]}`,
				{
					method: 'GET'
					// headers: {
					// 	'Content-Type': 'application/json'
					// }
				}
			);
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
				limit: 0
			},
			{
				onevent(event: Event) {
					event.created_at = Math.floor(Date.now() / 1000); // Doing this since event created_at not really reliable

					const channelTag = event.tags.find((tag) => tag[0] === 'd');
					if (validChannelName(channelTag?.[1] ?? '')) {
						let channel = channelTag ? channelTag[1] : '';
						channel = '#' + channel; // ensure it starts with a #

						addMessageToChannel(channel, event);
						subscribeMetadata();

						// Notify if message is not from current user
						// Check content for nostr:nprofile...
						const nprofileRegex = /\b(?:nostr:)?nprofile1[02-9ac-hj-np-z]+/g;
						const nprofileMatch = event.content.match(nprofileRegex);

						if (nprofileMatch) {
							for (const match of nprofileMatch) {
								const dec = decodeNostrURI(match);

								if (!dec) continue;
								if (dec.type !== 'nprofile') continue;
								const pubkey = dec.data.pubkey;

								if (pubkey === nostrPublicKey) {
									const from =
										metadata.get(event.pubkey)?.name || npubEncode(event.pubkey).slice(0, 12);
									// TODO: Replace nostr:nprofile with @name
									notify(`${from} mentioned you in ${channel}`, `${event.content}`);
									break;
								}
							}
						}
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
			.filter((msg): msg is Event => 'pubkey' in msg)
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
						pubkey: pubkey,
						name: (content as { name?: string }).name
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

	function addMessageToChannel(channel: string, event: Event | SystemEvent) {
		if (!channels.includes(channel)) {
			channels = [...channels, channel];
		}

		const current = messages.get(channel) ?? [];
		// if message is not in selected channel, add to unreadChannels
		if (channel !== selectedChannel && !unreadChannels.includes(channel)) {
			unreadChannels = [...unreadChannels, channel];
		}

		if ('pubkey' in event) {
			if (current.some((msg): msg is Event => 'id' in msg && msg.id === event.id)) {
				return; // Ignore duplicate messages
			}
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

	function changeChannel(channel: string) {
		if (!browser) return;
		if (channel === selectedChannel) return;

		const cleanse = channel.replaceAll('#', '');

		if (!validChannelName(cleanse)) {
			alert('Invalid channel name. No special characters. And 24 characters max.');
			return;
		}

		channel = '#' + cleanse;
		selectChannel(channel);
		// const params = new URLSearchParams();
		// params.set('channel', channel);
		// params.set('relay', relayUrl);
		// window.history.replaceState({}, '', '?' + params.toString());

		if (!channels.includes(channel)) {
			channels = [...channels, channel];
			selectChannel(channel);
		}
	}

	function addNewChannel(name: string | null = null) {
		if (!name) {
			name = prompt('Enter a new channel name (no # only letters and numbers):');
		} else {
			name = name.replaceAll('#', '');
		}
		if (!name) return;
		// const name = prompt('Enter a new channel name (no # only letters and numbers):');
		// if (!name) return;

		// const clean = name
		// 	.trim()
		// 	.replace(/\s+/g, '') // Replace spaces with dashes
		// 	.replaceAll('/', '') // Remove any slashes
		// 	.replaceAll('#', '') // Remove any hashes
		// 	.toLowerCase();

		if (!validChannelName(name)) {
			alert('Invalid channel name. No special characters. And 24 characters max.');
			return;
		}

		const channel = '#' + name;

		if (!channels.includes(channel)) {
			channels = [...channels, channel];
			selectChannel(channel);
		} else {
			selectChannel(channel);
		}
	}

	function clearEmptyChannels() {
		if (!browser) return;
		const emptyChannels = channels.filter((channel) => {
			const messagesInChannel = messages.get(channel);
			return !messagesInChannel || messagesInChannel.length === 0;
		});

		if (emptyChannels.length > 0) {
			channels = channels.filter((channel) => !emptyChannels.includes(channel));
			messages = new Map([...messages].filter(([key]) => !emptyChannels.includes(key)));
		}
	}

	async function sendMessage() {
		if (!input.trim()) return;
		if (!window.nostr) return;

		// if starts with / then its a command
		if (input.startsWith('/')) {
			const command = input.split(' ')[0].slice(1);
			if (command === 'help') {
				// simply add SystemMessage to the channel message map
				const systemEvent: SystemEvent = {
					type: 'help',
					content:
						'/help\n\nCommands:\n\n/help - Show this help message\n/csm - Clear system messages\n/cec - Clear empty channels\n/join <channel> - Join or create a channel',
					created_at: Math.floor(Date.now() / 1000)
				};
				addMessageToChannel(selectedChannel, systemEvent);
			} else if (command === 'csm') {
				// clear system messages
				// remove non Event messages from the channel
				const current = messages.get(selectedChannel) ?? [];
				const filtered = current.filter((msg) => 'pubkey' in msg);
				const newMap = new Map(messages);
				newMap.set(selectedChannel, filtered);
				messages = newMap;
			} else if (command === 'join') {
				if (input.split(' ').length != 2) {
					alert('Command: /join <channel>');
					return;
				}
				// join a channel
				const channel = input.split(' ')[1];
				if (!channel) {
					alert('Please provide a channel name.');
					return;
				}
				addNewChannel(channel);
			} else if (command === 'cec') {
				clearEmptyChannels();
			} else {
				alert(`Unknown command: ${command}`);
			}
		} else {
			// find @mentions in input
			// Also check for `@name could have spaces`
			const mentions = input.match(/`@([^`]+)`|@([a-zA-Z0-9_]+)/g);
			let pTags: string[][] = [];

			if (mentions) {
				mentions.forEach((mention) => {
					let cleanMention = '';

					if (mention.startsWith('`@')) {
						// Handle `@name with spaces`
						cleanMention = mention.slice(2, -1); // remove `@ and ending `
					} else {
						// Handle @name
						cleanMention = mention.slice(1); // remove @
					}

					const profile = Array.from(metadata.values()).find((p) => p.name === cleanMention);

					if (profile) {
						input = input.replace(mention, `nostr:${nprofileEncode({ pubkey: profile.pubkey })}`);
						pTags.push(['p', profile.pubkey]);
					}
				});
			}

			// filtre out duplicate ptags
			pTags = pTags.filter((value, index, self) => self.indexOf(value) === index);

			// remove "#" from selectedChannel
			let channel = selectedChannel.replace('#', '');
			let tag: string[][] = [];
			if (channel !== '' && validChannelName(channel)) {
				tag = [
					['d', channel],
					['relay', relayUrl]
				];
				if (pTags.length > 0) {
					tag = [...tag, ...pTags];
				}
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
		}

		input = '';
	}

	function openPubkeyProfile(pubkey: string) {
		if (!browser) return;
		const nprofile = nprofileEncode({ pubkey });
		const url = `https://nosta.me/${nprofile}`;
		window.open(url, '_blank');
	}

	function linkify(text: string): string {
		const urlRegex = /((https?:\/\/[^\s]+))/g;

		let linked = text.replace(
			urlRegex,
			'<a class="hover:underline text-blue-400" href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
		);

		const hashtagRegex = /(^|\s)(#[\p{L}\p{N}_]+)/gu;
		linked = linked.replace(
			hashtagRegex,
			(_, prefix, hashtag) =>
				`${prefix}<span title="Open channel ${hashtag}" class="text-orange-300 hover:underline cursor-pointer" onclick="changeChannel('${hashtag}')">${hashtag}</span>`
		);

		const nprofileRegex = /\b(?:nostr:)?nprofile1[02-9ac-hj-np-z]+/g;
		const nprofileMatch = text.match(nprofileRegex);

		if (nprofileMatch) {
			for (const match of nprofileMatch) {
				const dec = decodeNostrURI(match);

				if (!dec) continue;
				if (dec.type !== 'nprofile') continue;
				const pubkey = dec.data.pubkey;

				const profile = metadata.get(pubkey);
				if (!profile) continue;
				const name = profile.name;
				if (!name) continue;

				linked = linked.replace(
					match,
					`<span class="text-purple-300 hover:underline">@${name}</span>`
				);
			}
		}

		// lets check for npbu1 as well
		const npubRegext = /npub1[a-z\d]{58}/g;
		const npubMatch = text.match(npubRegext);
		if (npubMatch) {
			for (const match of npubMatch) {
				const dec = decodeNostrURI(match);

				if (!dec) continue;
				if (dec.type !== 'npub') continue;
				const pubkey = dec.data;
				const profile = metadata.get(pubkey);
				if (!profile) continue;
				const name = profile.name;
				if (!name) continue;

				linked = linked.replace(
					match,
					`<span class="text-purple-300 hover:underline">@${name}</span>`
				);
			}
		}

		// let check for nevent1 or naddr1 and create a link "https://njump.me/nevent1..."
		const neventRegext = /(nostr:nevent1|nevent1|nostr:naddr1|naddr1)[a-z\d]+/g;
		const neventMatch = text.match(neventRegext);
		if (neventMatch) {
			for (const match of neventMatch) {
				const dec = decodeNostrURI(match);
				const njumpLink = `https://njump.me/${match.replace('nostr:', '')}`;

				if (!dec) continue;

				linked = linked.replace(
					match,
					`<a class="hover:underline text-blue-400" href="${njumpLink}" target="_blank" rel="noopener noreferrer">${truncateMiddle(njumpLink, 56)}</a>`
				);
			}
		}

		return linked;
	}

	function encodeShareLink(relay: string, channel: string, withBaseUrl: boolean): string {
		const path = `${channel.replaceAll('#', '')}?relay=${relay}`;
		if (!withBaseUrl) {
			return `/${path}`;
		}
		const baseUrl = `${$page.url.origin}`;
		return `${baseUrl}/${path}`;
	}

	function toggleSidebar() {
		showSidebar = !showSidebar;
	}

	function selectChannel(channel: string) {
		selectedChannel = channel;
		// remove channel from unreadChannels
		unreadChannels = unreadChannels.filter((c) => c !== channel);
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
			channels = ['#_'];
			selectedChannel = '#_';

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
					onclick={() => addNewChannel()}
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
						{#if unreadChannels.includes(channel)}
							<span class="font-black text-white">
								{channel} <span class="float-end">●</span>
							</span>
						{:else}
							<span class={channel === selectedChannel ? 'text-white' : 'text-gray-400'}>
								{channel}
							</span>
						{/if}
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
							({npubEncode(nostrPublicKey).slice(0, 12)}) {metadata.get(nostrPublicKey)?.nip05}
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
					{#if 'pubkey' in event}
						<Message
							{nostrPublicKey}
							{event}
							profileInfo={metadata.get(event.pubkey)}
							verified={verified.includes(event.pubkey)}
							{linkify}
							{openPubkeyProfile}
						/>
					{:else if 'type' in event}
						<SystemMessage {event} {linkify} />
					{/if}
				{/each}
			{:else}
				<div class="text-cyan-50">No messages yet...</div>
			{/if}
		</div>

		<!-- Input Bar -->
		<form class="flex border-t border-cyan-700 p-2" onsubmit={sendMessage}>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				autofocus
				type="text"
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
