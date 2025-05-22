<script lang="ts">
	import { browser } from '$app/environment';

	import { onMount, tick } from 'svelte';
	import { validChannelName, truncateMiddle, emoticonMap, isValidWsUrl } from '$lib';
	import { page } from '$app/state';
	import { uuidv7 } from 'uuidv7';
	import autoAnimate from '@formkit/auto-animate';

	import type { EventTemplate, Event } from 'nostr-tools';
	import { nprofileEncode, npubEncode, decodeNostrURI } from 'nostr-tools/nip19';
	import Message from '$lib/components/Message.svelte';
	import SystemMessage from '$lib/components/SystemMessage.svelte';
	import { type SystemEvent } from '$lib/db';
	import { CoolrState, CHAT_KIND } from '$lib/coolr-state.svelte';
	import { replaceState } from '$app/navigation';

	const coolrState = new CoolrState();

	let emojiMap = $state<Map<string, string[]>>(new Map());

	// Html element bindings
	let textareaEl: HTMLTextAreaElement;
	let chatContainer: HTMLDivElement;

	let showSidebar = $state(true);
	let autoScroll = $state(true);
	let input = $state('');

	// Modal related state
	let showEmojiPicker = $state(false);
	let showWelcomeModal = $state(false);
	let showSettingsModal = $state(false);
	let showRelayModal = $state(false);
	let relayInput = $state('');
	let relayList = $state(['wss://relay.damus.io', 'wss://nos.lol']);
	let changingUrl = false;

	onMount(() => {
		if (!browser) return;

		if (!localStorage.getItem('coolr-welcome-shown')) {
			showWelcomeModal = true;
		}

		coolrState.loadCache();

		// Show welcome modal if needed
		if (coolrState.relayUrl === '') {
			showRelayModal = true;
		}

		// Select channel
		const currentSelectedChannel = localStorage.getItem('selectedChannel');
		if (currentSelectedChannel) {
			//coolrState.changeChannel(currentSelectedChannel);
			coolrState.selectedChannel = currentSelectedChannel;
		}

		coolrState.connectToRelay();
		coolrState.subscribeMetadata();

		setTimeout(() => {
			if ((coolrState.messages.get(coolrState.selectedChannel) ?? []).length > 0) {
				scrollToBottom();
			}
			handlePath();
		}, 0); // Wait for DOM to update

		// Used to handle selecting channels from hashtags
		if (typeof window !== 'undefined') {
			(window as any).changeChannel = coolrState.changeChannel;
		}

		setEmojiMap();
	});

	$effect(() => {
		if (!browser) return;
		if (coolrState.tabActive) {
			// If the tab is active and unread selected channel has unread messages, clear unread for channel
			if (coolrState.unreadChannels.includes(coolrState.selectedChannel)) {
				// use timeout to wait 1 second before clearing unread
				setTimeout(() => {
					coolrState.unreadChannels = coolrState.unreadChannels.filter(
						(c) => c !== coolrState.selectedChannel
					);
				}, 1000);
			}
		}

		coolrState.saveCache(); // TODO: Maybe debounce this or be more selective

		if (autoScroll && coolrState.messages.size > 0) {
			if ((coolrState.messages.get(coolrState.selectedChannel) ?? []).length > 0) {
				scrollToBottom();
			}
		}

		// If any unread channels set document title
		if (coolrState.unreadChannels.length > 0) {
			document.title = `(${coolrState.unreadChannels.length}) ${coolrState.selectedChannel}`;
		} else {
			document.title = `${coolrState.selectedChannel}`;
		}

		//handlePath();
	});

	function handlePath() {
		if (!browser) return;
		const params = page.url.searchParams;
		const relay = params.get('relay');
		let channel = params.get('channel');

		if (channel) {
			channel = channel.replace('#', '');
		}

		const currentRelay = coolrState.relayUrl;
		const currentChannel = coolrState.selectedChannel.replace('#', '');

		// Do nothing if the relay and channel are the same
		if (!channel || !validChannelName(channel)) return;
		if (!relay || !isValidWsUrl(relay)) return;
		if (!relay && !channel) return;
		if (relay === currentRelay && channel === currentChannel) return;

		if (relay !== currentRelay) {
			coolrState.pool.destroy();

			coolrState.relayUrl = relay!;
			coolrState.saveCache();

			coolrState.loadCache();

			coolrState.connectToRelay();

			if (channel !== currentChannel) {
				coolrState.selectedChannel = '#' + channel;
				setTimeout(() => {
					coolrState.changeChannel(channel!);
				}, 750);
			}
		} else if (channel !== currentChannel) {
			setTimeout(() => {
				coolrState.changeChannel(channel!);
			}, 750);
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
		console.log('Adding channel', channel);

		coolrState.changeChannel(channel);
	}

	// KEEP HERE
	async function sendMessage() {
		if (!input.trim()) return;
		if (!window.nostr) return;

		// if starts with / then its a command
		if (input.startsWith('/')) {
			const command = input.split(' ')[0].slice(1);
			if (command === 'help') {
				// simply add SystemMessage to the channel message map
				const systemEvent: SystemEvent = {
					channel: coolrState.selectedChannel,
					id: uuidv7(),
					type: 'help',
					content:
						'/help\n\nCommands:\n\n/help - Show this help message\n/csm - Clear system messages\n/cec - Clear empty channels\n/join <channel> - Join or create a channel',
					created_at: Math.floor(Date.now() / 1000)
				};
				coolrState.addMessageToChannel(coolrState.selectedChannel, systemEvent);
			} else if (command === 'csm') {
				// clear system messages
				// remove non Event messages from the channel
				const current = coolrState.messages.get(coolrState.selectedChannel) ?? [];
				const filtered = current.filter((msg) => 'pubkey' in msg);
				const newMap = new Map(coolrState.messages);
				newMap.set(coolrState.selectedChannel, filtered);
				coolrState.messages = newMap;
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
				coolrState.clearEmptyChannels();
			} else {
				alert(`Unknown command: ${command}`);
			}
		} else {
			// check for emoji shortcodes like :smile:
			const emojiRegex = /:[a-zA-Z0-9_]+:/g;
			const emojiMatch = input.match(emojiRegex);
			if (emojiMatch) {
				emojiMatch.forEach((shortcode) => {
					const emoji = findEmojiByShortcode(shortcode);
					if (emoji) {
						input = input.replace(shortcode, emoji);
					}
				});
			}

			// Also check for emoticons like :) :-)
			// TODO: Not sure if this is best way to do this
			// for (const [emoticon, emoji] of emoticonMap.entries()) {
			// 	// Escape for regex, then replace all
			// 	const escaped = emoticon.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
			// 	input = input.replace(new RegExp(escaped, 'g'), emoji);
			// }

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

					const profile = Array.from(coolrState.profileMetadata.values()).find(
						(p) => p.name === cleanMention
					);

					if (profile) {
						input = input.replace(mention, `nostr:${nprofileEncode({ pubkey: profile.pubkey })}`);
						pTags.push(['p', profile.pubkey]);
					}
				});
			}

			// filtre out duplicate ptags
			pTags = pTags.filter((value, index, self) => self.indexOf(value) === index);

			// remove "#" from selectedChannel
			let channel = coolrState.selectedChannel.replace('#', '');
			let tag: string[][] = [];
			if (channel !== '' && validChannelName(channel)) {
				tag = [
					['d', channel],
					['relay', coolrState.relayUrl]
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
				await Promise.any(coolrState.pool.publish([coolrState.relayUrl], signedEvent));
			});
		}

		input = '';
		if (textareaEl) {
			textareaEl.style.height = 'auto';
		}
	}

	function insertEmoji(e: any) {
		const emoji = e.detail.unicode;

		const inputEl = document.querySelector('textarea') as HTMLTextAreaElement;
		if (!inputEl) return;

		const start = inputEl.selectionStart;
		const end = inputEl.selectionEnd;
		if (start === null || end === null) return;

		// Use actual textarea value to avoid stale `input`
		const currentValue = inputEl.value;
		const updatedValue = currentValue.slice(0, start) + emoji + currentValue.slice(end);

		input = updatedValue;

		// Restore cursor after emoji insert
		setTimeout(() => {
			inputEl.focus();
			inputEl.setSelectionRange(start + emoji.length, start + emoji.length);
		}, 0);

		showEmojiPicker = false;
	}

	function setEmojiMap() {
		// const request = indexedDB.open('emoji-picker-element-en');
		// request.onsuccess = () => {
		// 	const db = request.result;
		// 	// Get all emoji data from the database
		// 	//console.log('Database opened successfully:', db);
		// 	// query to store 'emoji'
		// 	// where result value contains shortcodes['heart']
		// 	const transaction = db.transaction('emoji', 'readonly');
		// 	const store = transaction.objectStore('emoji');
		// 	const allEmojis = store.getAll();
		// 	// map over allEmojis and filter by shortcodes
		// 	allEmojis.onsuccess = () => {
		// 		// Store them in a map where the emoji unicode is the key
		// 		// and the shortcods array is the value
		// 		const emojis = allEmojis.result;
		// 		const em = new Map<string, string[]>();
		// 		emojis.forEach((emoji: any) => {
		// 			const shortcodes = emoji.shortcodes.map((s: string) => `:${s}:`);
		// 			const unicode = emoji.unicode;
		// 			for (const shortcode of shortcodes) {
		// 				if (!em.has(shortcode)) {
		// 					em.set(shortcode, []);
		// 				}
		// 				em.get(shortcode)?.push(unicode);
		// 			}
		// 		});
		// 		emojiMap = em;
		// 	};
		// };
	}

	function findEmojiByShortcode(shortcode: string) {
		if (!browser) return null;
		const emojis = emojiMap.get(shortcode);
		return emojis?.[0] ?? null;
	}

	function findEmojiByEmoticon(emoticon: string) {
		if (!browser) return null;
		const emojis = emoticonMap.get(emoticon);
		return emojis?.[0] ?? null;
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

		const emojiRegex = /:[a-zA-Z0-9_]+:/g;
		const emojiMatch = linked.match(emojiRegex);
		if (emojiMatch) {
			emojiMatch.forEach((shortcode) => {
				const emoji = findEmojiByShortcode(shortcode);
				if (emoji) {
					linked = linked.replace(shortcode, emoji);
				}
			});
		}

		// Also check for emoticons like :) :-)
		// TODO: Not sure if this is best way to do this
		// for (const [emoticon, emoji] of emoticonMap.entries()) {
		// 	// Escape for regex, then replace all
		// 	const escaped = emoticon.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');
		// 	linked = linked.replace(new RegExp(escaped, 'g'), emoji);
		// }

		const nprofileRegex = /\b(?:nostr:)?nprofile1[02-9ac-hj-np-z]+/g;
		const nprofileMatch = text.match(nprofileRegex);

		if (nprofileMatch) {
			for (const match of nprofileMatch) {
				const dec = decodeNostrURI(match);

				if (!dec) continue;
				if (dec.type !== 'nprofile') continue;
				const pubkey = dec.data.pubkey;

				const profile = coolrState.profileMetadata.get(pubkey);
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
				const profile = coolrState.profileMetadata.get(pubkey);
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
		const path = `?relay=${relay}&channel=${channel.replaceAll('#', '')}`;
		if (!withBaseUrl) {
			return `/${path}`;
		}
		const baseUrl = `${page.url.origin}`;
		return `${baseUrl}/${path}`;
	}

	function toggleSidebar() {
		showSidebar = !showSidebar;
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
		if (!isValidWsUrl(relayInput)) {
			alert('Invalid relay URL. Please enter a valid WebSocket URL.');
			return;
		}
		if (relayInput !== '' && relayInput !== coolrState.relayUrl) {
			coolrState.pool.destroy();

			setTimeout(() => {
				coolrState.relayUrl = relayInput;
				relayInput = '';
				localStorage.setItem('relayUrl', coolrState.relayUrl);

				coolrState.loadCache();
				coolrState.selectedChannel = '#_';

				coolrState.connectToRelay();
			}, 300);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	function autoResize() {
		if (textareaEl) {
			textareaEl.style.height = 'auto';
			textareaEl.style.height = `${textareaEl.scrollHeight}px`;
		}
	}
</script>

<audio bind:this={coolrState.audio} src="notify.mp3" preload="auto"></audio>

{#if showSettingsModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
		<div class="w-full max-w-sm rounded-lg border border-cyan-700 bg-gray-800 p-6 shadow-lg">
			<h2 class="mb-4 text-lg font-bold text-cyan-200">Settings</h2>
			<div class="mb-6 space-y-4">
				<div class="flex items-center justify-between">
					<label for="notif-sound" class="text-cyan-100">Notification Sound</label>
					<input
						id="notif-sound"
						type="checkbox"
						class="h-5 w-5 accent-cyan-600"
						bind:checked={coolrState.notificationSound}
						onchange={() =>
							localStorage.setItem(
								'coolr-notification-sound',
								String(coolrState.notificationSound)
							)}
					/>
				</div>
				<button
					class="w-full rounded bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700"
					onclick={coolrState.clearAllSiteData}
				>
					Clear All Site Data
				</button>
				<p class="mt-4 text-sm text-cyan-100">
					This will remove all cached messages, profiles, and settings. The page will reload.
				</p>
			</div>
			<div class="flex justify-end">
				<button
					class="rounded bg-gray-700 px-3 py-1 text-cyan-200 hover:bg-gray-600"
					onclick={() => (showSettingsModal = false)}
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showWelcomeModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
		<div class="w-full max-w-lg rounded-lg border border-cyan-700 bg-gray-800 p-6 shadow-lg">
			<h2 class="mb-4 text-2xl font-bold text-cyan-200">Welcome to Coolr!</h2>
			<div class="mb-4 space-y-2 text-cyan-100">
				<p>
					<strong>Coolr</strong> is a simple, open-source, ephemeral group chat built on
					<a href="https://nostr.com" target="_blank" class="text-cyan-400 underline">Nostr</a>.
				</p>
				<ul class="list-disc pl-5">
					<li>Connect using your favorite your Nostr extension.</li>
					<li>
						Join or create public channels using hashtags (e.g. <span class="text-orange-300"
							>#general</span
						>).
					</li>
					<li>
						All messages are ephemeral (temporary), you only see messages if you are connected.
					</li>
					<li>
						Open source: <a
							href="https://github.com/Galaxoid-labs/coolr-web"
							target="_blank"
							class="text-cyan-400 underline">GitHub</a
						>
					</li>
				</ul>
				<p>
					To get started, pick a relay and join or create a channel. If needed install a Nostr
					browser extension like <a
						href="https://nostrapps.com/alby"
						target="_blank"
						class="text-cyan-400 underline">Alby</a
					>
					or
					<a href="https://nostrapps.com/nos2x" target="_blank" class="text-cyan-400 underline"
						>Nos2x</a
					>.
				</p>
			</div>
			<div class="flex justify-end">
				<button
					class="rounded bg-cyan-600 px-4 py-2 font-bold text-black hover:bg-cyan-700"
					onclick={() => {
						showWelcomeModal = false;
						localStorage.setItem('coolr-welcome-shown', '1');
					}}
				>
					Get Started
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showRelayModal && !showWelcomeModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden bg-black/70">
		<div class="w-full max-w-md rounded-lg border border-cyan-700 bg-gray-800 p-6 shadow-lg">
			<h2 class="mb-4 text-lg font-bold text-cyan-200">Choose Relay</h2>
			<input
				class="mb-4 w-full rounded border border-cyan-700 bg-gray-900 p-2 text-cyan-100"
				bind:value={relayInput}
				placeholder="wss://"
				autofocus
			/>
			<div class="mb-4">
				<div class="mb-2 text-cyan-400">Popular Relays:</div>
				<ul>
					{#each relayList as relay}
						<li>
							<button
								type="button"
								class="w-full rounded px-2 py-1 text-left text-cyan-200 hover:bg-cyan-700"
								onclick={() => (relayInput = relay)}
							>
								{relay}
							</button>
						</li>
					{/each}
				</ul>
			</div>
			<div class="flex justify-end gap-2">
				<button
					class="rounded bg-gray-700 px-3 py-1 text-cyan-200 hover:bg-gray-600"
					onclick={() => (showRelayModal = false)}
				>
					Cancel
				</button>
				<button
					class="rounded bg-cyan-600 px-3 py-1 font-bold text-black hover:bg-cyan-700"
					onclick={() => {
						changeRelayUrl();
						if (relayInput !== '') {
							showRelayModal = false;
						}
					}}
				>
					Connect
				</button>
			</div>
		</div>
	</div>
{/if}

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
			<div use:autoAnimate={{ duration: 100 }} class="flex-1 overflow-y-auto text-sm">
				{#each coolrState.channels as channel}
					<div
						class="cursor-pointer px-2 py-1 hover:bg-cyan-700 hover:text-black {channel ===
						coolrState.selectedChannel
							? 'bg-cyan-700 text-black'
							: ''}"
						onclick={() => {
							coolrState.changeChannel(channel);
							setTimeout(() => {
								scrollToBottom();
							}, 0);
						}}
					>
						{#if coolrState.unreadChannels.includes(channel)}
							<span class="font-black text-white">
								{channel} <span class="float-end">●</span>
							</span>
						{:else}
							<span class={channel === coolrState.selectedChannel ? 'text-white' : 'text-gray-400'}>
								{channel}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Chat Area -->
	<div class="flex flex-1 flex-col overflow-x-hidden break-words whitespace-pre-wrap">
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
					<span class="text-cyan-100"> {coolrState.selectedChannel} </span> |
					<span
						class="cursor-pointer text-purple-300 hover:underline"
						onclick={() => (showRelayModal = true)}>{coolrState.relayUrl || 'Choose Relay'}</span
					>
					{#if !coolrState.nostrPublicKey}
						|
						<button class="ml-1 text-red-500 hover:underline" onclick={coolrState.login}>
							(Login with Extension)
						</button>
					{:else}
						|
						<span class="text-cyan-300">
							({npubEncode(coolrState.nostrPublicKey).slice(0, 12)}) {coolrState.profileMetadata.get(
								coolrState.nostrPublicKey
							)?.nip05}
						</span>
					{/if}
				</span>
			</div>
			<div class="flex items-center gap-2">
				<!-- Share Button -->
				<button
					class="text-cyan-400 hover:text-cyan-200"
					title="Share Channel"
					onclick={() => {
						const shareUrl = encodeShareLink(coolrState.relayUrl, coolrState.selectedChannel, true);
						navigator.clipboard
							.writeText(shareUrl)
							.then(() => {
								alert('Share link copied to clipboard!\n' + shareUrl);
							})
							.catch(() => {
								prompt('Copy this link:', shareUrl);
							});
					}}
				>
					🔗
				</button>
				<button
					class="ml-2 text-cyan-400 hover:text-cyan-200"
					title="Settings"
					onclick={() => (showSettingsModal = true)}
				>
					⚙️
				</button>
			</div>
		</div>

		<!-- Chat Messages -->
		<div
			use:autoAnimate={{ duration: 100 }}
			class="flex-1 space-y-1 overflow-x-auto overflow-y-auto p-2 text-sm break-words whitespace-pre-wrap"
			bind:this={chatContainer}
			onscroll={handleScroll}
		>
			<!-- Display messages for the selected channel -->
			{#if coolrState.messages.has(coolrState.selectedChannel)}
				{#each coolrState.messages.get(coolrState.selectedChannel) ?? [] as event}
					{#if 'pubkey' in event}
						<Message
							nostrPublicKey={coolrState.nostrPublicKey}
							{event}
							profileInfo={coolrState.profileMetadata.get(event.pubkey)}
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
			<!-- svelte-ignore element_invalid_self_closing_tag -->
			<textarea
				id="message-input"
				bind:this={textareaEl}
				autofocus
				bind:value={input}
				onkeydown={handleKeydown}
				oninput={autoResize}
				placeholder="Type a message..."
				class="max-h-40 min-h-[1.0rem] flex-1 resize-none overflow-hidden rounded border-none bg-gray-900 px-2 py-[0.3rem] text-cyan-100 focus:outline-none"
				autocomplete="off"
				rows="1"
			/>

			<!-- Emoji Button -->
			<button
				type="button"
				onclick={() => (showEmojiPicker = !showEmojiPicker)}
				class="ml-2 rounded bg-gray-700 px-3 py-1 text-cyan-200 hover:bg-gray-600"
			>
				😊
			</button>

			<!-- Send Button -->
			<button
				type="submit"
				class="ml-2 rounded bg-cyan-600 px-3 py-1 font-bold text-black hover:bg-cyan-700"
			>
				Send
			</button>

			<!-- Emoji Picker Popover -->
			{#if showEmojiPicker}
				<emoji-picker
					class="dark absolute right-2 bottom-12 z-50 rounded shadow-lg"
					style="width: 320px; max-height: 400px;"
					onemoji-click={insertEmoji}
				></emoji-picker>
			{/if}
		</form>
	</div>
</div>
