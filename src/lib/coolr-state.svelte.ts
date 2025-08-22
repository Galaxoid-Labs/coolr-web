import { db, type MessageEvent, type ProfileInfo, type SystemEvent } from '$lib/db';
import { browser } from '$app/environment';
import { SimplePool } from 'nostr-tools/pool';
import { validChannelName } from '$lib';
import { decodeNostrURI, npubEncode } from 'nostr-tools/nip19';
import { replaceState } from '$app/navigation';

export const METADATA_RELAY_URL = 'wss://purplepag.es';
export const CHAT_KIND = 23333; // kind for channel messages: TBD
export const BITCHAT_KIND = 20000; // kind for bitchain messages

export class CoolrState {
	nostrPublicKey = $state('');
	profileMetadata = $state<Map<string, ProfileInfo>>(new Map());
	messages = $state<Map<string, (MessageEvent | SystemEvent)[]>>(new Map());
	channels = $state(['#_']);
	unreadChannels = $state([] as string[]);
	selectedChannel = $state('#_');

	relayUrl = $state('');

	// bitchat nick
	//bitchatNick = $state('');

	tabActive = $state(true);
	notificationSound = $state(true);
	audio: HTMLAudioElement | null = null;

	pool: SimplePool;

	constructor() {
		this.pool = new SimplePool();
		if (browser) {
			document.addEventListener('visibilitychange', () => {
				this.tabActive = document.visibilityState === 'visible';
			});
		}
	}

	loadCache = async () => {
		if (!browser) return;
		const version = localStorage.getItem('version');
		if (version !== '4') {
			localStorage.clear();
			localStorage.setItem('version', '4');
		}

		const soundPref = localStorage.getItem('coolr-notification-sound');
		if (soundPref !== null) {
			this.notificationSound = soundPref === 'true';
		}

		const storedRelayUrl = localStorage.getItem('relayUrl');
		if (storedRelayUrl) {
			this.relayUrl = storedRelayUrl;
		}

		const currentNostrPublicKey = localStorage.getItem('nostrPublicKey');
		if (currentNostrPublicKey) {
			this.nostrPublicKey = currentNostrPublicKey;
		}

		// Load cache from indexedDB into messages map
		const events = await db.messages.where('relayUrl').equals(this.relayUrl).toArray();
		this.messages.clear();
		events.sort((a, b) => a.created_at - b.created_at);
		events.forEach((event) => {
			const channel = event.channel || '';
			const current = this.messages.get(channel) ?? [];
			this.messages.set(channel, [...current, event]);
		});
		this.messages = new Map(this.messages);

		// Load profiles cache
		const profiles = await db.profiles.toArray();
		profiles.forEach((profile) => {
			this.profileMetadata.set(profile.pubkey, profile);
		});
		this.profileMetadata = new Map(this.profileMetadata);

		// Load channels cache
		const channelsData = await db.channels.where('relayUrl').equals(this.relayUrl).first();
		if (channelsData) {
			this.channels = channelsData.channels;
		} else {
			this.channels = ['#_'];
		}

		// Load unread channels cache
		const unreadChannelsData = await db.unreadChannels
			.where('relayUrl')
			.equals(this.relayUrl)
			.first();
		if (unreadChannelsData) {
			this.unreadChannels = unreadChannelsData.channels;
		} else {
			this.unreadChannels = [];
		}
	};

	saveCache = async () => {
		if (!browser) return;

		localStorage.setItem('relayUrl', this.relayUrl);

		try {
			const messagesArray = Array.from(this.messages.values()).flat();
			await db.messages.bulkPut(messagesArray);
		} catch (e) {
			console.error('Error saving messages to indexedDB:', e);
		}

		try {
			const profilesArray = Array.from(this.profileMetadata.values()); // TODO: Need .flat() here?
			await db.profiles.bulkPut(profilesArray);
		} catch (e) {
			console.error('Error saving profiles to indexedDB:', e);
		}

		try {
			await db.channels.put({
				relayUrl: this.relayUrl,
				channels: Array.from(this.channels.values())
			});
		} catch (e) {
			console.error('Error saving channels to indexedDB:', e);
		}

		try {
			await db.unreadChannels.put({
				relayUrl: this.relayUrl,
				channels: Array.from(this.unreadChannels.values())
			});
		} catch (e) {
			console.error('Error saving unread channels to indexedDB:', e);
		}

		localStorage.setItem('selectedChannel', this.selectedChannel);
		localStorage.setItem('nostrPublicKey', this.nostrPublicKey);
	};

	clearAllSiteData = () => {
		if (
			confirm(
				'Are you sure you want to clear all site data? This will log you out and remove all cached messages, profiles, and settings.'
			)
		) {
			localStorage.clear();
			if (db) {
				db.delete().then(() => {
					location.reload();
				});
			} else {
				location.reload();
			}
		}
	};

	verifyNip05 = async (nip05: string, pubkey: string) => {
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
					if (pubkeyFromName === pubkey) {
						// Update metadata map
						const current = this.profileMetadata.get(pubkey) ?? null;
						if (current) {
							current.verified = true;
							this.profileMetadata.set(pubkey, { ...current });
						}
					}
				}
			}
		} catch (error) {
			console.log('Error verifying NIP-05:', error);
		}
	};

	login = async () => {
		if (!browser) return;
		if (window.nostr) {
			try {
				this.nostrPublicKey = await window.nostr.getPublicKey();
				this.subscribeMetadata();
				console.log('Logged in with Nostr public key:', this.nostrPublicKey);
			} catch (error) {
				console.error('Error logging in with Nostr:', error);
			}
		} else {
			console.error('Nostr is not available');
		}
	};

	connectToRelay = () => {
		if (!browser) return;
		if (!this.pool) return;
		if (!this.relayUrl) return;

		const self = this;

		this.pool.subscribe(
			[this.relayUrl],
			{
				kinds: [CHAT_KIND, BITCHAT_KIND],
				limit: 0
			},
			{
				onevent(event: MessageEvent) {
					event.created_at = Math.floor(Date.now() / 1000); // Doing this since event created_at not really reliable

					if (event.kind === CHAT_KIND) {
						
						const channelTag = event.tags.find((tag) => tag[0] === 'd');
						if (validChannelName(channelTag?.[1] ?? '')) {
							let channel = channelTag ? channelTag[1] : '';
							channel = '#' + channel; // ensure it starts with a #

							// MessageEvent
							event.channel = channel;
							event.relayUrl = self.relayUrl;

							self.addMessageToChannel(channel, event);
							self.subscribeMetadata();

							// TEST
							//db.messages.add(event);

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

									if (pubkey === self.nostrPublicKey) {
										const from =
											self.profileMetadata.get(event.pubkey)?.name ||
											npubEncode(event.pubkey).slice(0, 12);
										// TODO: Replace nostr:nprofile with @name
										self.notify(`${from} mentioned you in ${channel}`, `${event.content}`);
										break;
									}
								}
							}
						}

					} else if (event.kind === BITCHAT_KIND) {

						//console.log('Received BITCHAT event:', event);
						const channelTag = event.tags.find((tag) => tag[0] === 'g');
						const nickTag = event.tags.find((tag) => tag[0] === 'n');

						if (channelTag === undefined || nickTag === undefined) {
							return;
						}
					
						if (validChannelName(channelTag?.[1] ?? '')) {
							let channel = channelTag ? channelTag[1] : '';
							channel = '#bc_' + channel; // ensure it starts with a #

							// MessageEvent
							event.channel = channel;
							event.relayUrl = self.relayUrl;

							self.addMessageToChannel(channel, event);
							self.subscribeMetadata();

							if (event.pubkey !== self.nostrPublicKey) {
								let profile: ProfileInfo = {
									pubkey: event.pubkey,
									verified: false,
									name: nickTag[1] + "#" + event.pubkey.slice(-4)
								};

								self.profileMetadata.set(event.pubkey, profile);
								const newMap = new Map(self.profileMetadata);
								self.profileMetadata = newMap;
							}

						}

					}

				},
				onclose(reasons: string[]) {
					console.log('Connection closed:', reasons);
					// TODO: Not sure if this is best way to handle disconnects??
					// Wish we had a close code to check for instead of string that could change
					if (!reasons.includes('relay connection closed by us')) {
						setTimeout(() => {
							self.pool.destroy();
							console.log('Reconnecting...');
							self.connectToRelay();
						}, 5000);
					}
				}
			}
		);
	};

	subscribeMetadata = () => {
		if (!browser) return;
		if (!this.pool) return;

		const self = this;

		// get unique pubkeys from messages
		// Filter out bitchat messages since they will not likely have any metadata
		// We will create 
		const pubkeys = Array.from(this.messages.values())
			.flat()
			.filter((msg): msg is MessageEvent => 'pubkey' in msg)
			//.filter((msg): msg is MessageEvent => msg.kind !== BITCHAT_KIND) // We dont care about getting metadata for bitchat users
			.map((event) => event.pubkey)
			.filter((value, index, self) => self.indexOf(value) === index);

		// lets add current nostr pubkey to the list
		if (this.nostrPublicKey && !pubkeys.includes(this.nostrPublicKey)) {
			pubkeys.push(this.nostrPublicKey);
		}

		if (pubkeys.length === 0) return; // No new pubkeys to subscribe to

		this.pool.subscribe(
			[METADATA_RELAY_URL, this.relayUrl, "wss://relay.primal.net"],
			{
				kinds: [0],
				authors: pubkeys
			},
			{
				id: 'metadata',
				onevent(event: MessageEvent) {
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
						verified: false,
						name: (content as { name?: string }).name
					};

					if (nip05) {
						profile.nip05 = nip05;
						const current = self.profileMetadata.get(pubkey) ?? null;
						if (current) {
							profile.verified = current.verified;
							self.profileMetadata.set(pubkey, { ...current, ...profile });
						} else {
							self.profileMetadata.set(pubkey, profile);
						}

						const newMap = new Map(self.profileMetadata);
						self.profileMetadata = newMap;

						// Check if nip05 is verified
						// if (!profile.verified) {
						// 	self.verifyNip05(nip05, pubkey);
						// }
					} else {
						const current = self.profileMetadata.get(pubkey) ?? null;
						if (current) {
							profile.verified = current.verified;
							self.profileMetadata.set(pubkey, { ...current, ...profile });
						} else {
							self.profileMetadata.set(pubkey, profile);
						}

						const newMap = new Map(self.profileMetadata);
						self.profileMetadata = newMap;
					}
				}
			}
		);
	};

	addMessageToChannel = (channel: string, event: MessageEvent | SystemEvent) => {
		if (!this.channels.includes(channel)) {
			this.channels = [...this.channels, channel];
		}

		const current = this.messages.get(channel) ?? [];
		// if message is not in selected channel, add to unreadChannels
		if (channel !== this.selectedChannel) {
			if (!this.unreadChannels.includes(channel)) {
				this.unreadChannels = [...this.unreadChannels, channel];
				this.notifyWithSound();
			}
		} else if (channel === this.selectedChannel && !this.tabActive) {
			if (!this.unreadChannels.includes(channel)) {
				this.unreadChannels = [...this.unreadChannels, channel];
				this.notifyWithSound();
			}
		}

		if ('pubkey' in event) {
			if (current.some((msg): msg is MessageEvent => 'id' in msg && msg.id === event.id)) {
				return; // Ignore duplicate messages
			}
		}

		const updated = [...current, event];

		// Trim from the front if over limit
		const MAX_MESSAGES = 500; // Maximum number of messages to keep per channel
		const limited = updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated;

		// Trigger reactivity by replacing the Map
		const newMap = new Map(this.messages);
		newMap.set(channel, limited);
		this.messages = newMap;
	};

	notify = (title: string, body: string) => {
		if (Notification.permission === 'granted') {
			new Notification(title, { body, icon: '/favicon-32x32.png' });
		} else if (Notification.permission !== 'denied') {
			Notification.requestPermission().then((perm) => {
				if (perm === 'granted') {
					new Notification(title, { body, icon: '/favicon-32x32.png' });
				}
			});
		}
	};

	notifyWithSound = () => {
		if (!this.notificationSound) return;
		if (this.audio) {
			this.audio.play().catch((err) => {
				console.error('Playback failed:', err);
			});
		}
	};

	clearEmptyChannels = () => {
		if (!browser) return;
		const emptyChannels = this.channels.filter((channel) => {
			const messagesInChannel = this.messages.get(channel);
			return !messagesInChannel || messagesInChannel.length === 0;
		});

		if (emptyChannels.length > 0) {
			this.channels = this.channels.filter((channel) => !emptyChannels.includes(channel));
			this.messages = new Map([...this.messages].filter(([key]) => !emptyChannels.includes(key)));
		}
	};

	changeChannel = (channel: string) => {
		if (!browser) return;
		if (channel === this.selectedChannel) return;

		const cleanse = channel.replaceAll('#', '');

		if (!validChannelName(cleanse)) {
			alert('Invalid channel name. No special characters. And 24 characters max.');
			return;
		}

		channel = '#' + cleanse;

		if (!this.channels.includes(channel)) {
			this.channels = [...this.channels, channel];
		}

		this.selectedChannel = channel;
		this.unreadChannels = this.unreadChannels.filter((c) => c !== channel);

		// update url params with relay and channel
		const params = `relay=${this.relayUrl}&channel=${cleanse}`;
		const newUrl = `${window.location.pathname}?${params}`;
		replaceState(newUrl, '');
	};
}
