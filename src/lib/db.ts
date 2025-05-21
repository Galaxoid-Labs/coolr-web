import Dexie, { type EntityTable } from 'dexie';
import type { Event } from 'nostr-tools';

export interface MessageEvent extends Event {
	relayUrl?: string;
	channel?: string;
}

export interface Channels {
	relayUrl: string;
	channels: string[];
}

export interface ProfileInfo {
	pubkey: string;
	verified: boolean;
	nip05?: string;
	name?: string;
}

export interface SystemEvent {
	id: string;
	channel: string;
	type: 'error' | 'info' | 'help';
	created_at: number;
	content: string;
}

export const db = new Dexie('coolr') as Dexie & {
	messages: EntityTable<MessageEvent | SystemEvent, 'id'>;
	profiles: EntityTable<ProfileInfo, 'pubkey'>;
	channels: EntityTable<Channels, 'relayUrl'>;
	unreadChannels: EntityTable<Channels, 'relayUrl'>;
};

db.version(1).stores({
	messages: 'id, created_at, pubkey, kind, type, relayUrl, channel',
	profiles: 'pubkey, nip05, name, verified',
	channels: 'relayUrl',
	unreadChannels: 'relayUrl'
});
