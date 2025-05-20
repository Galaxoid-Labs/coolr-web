import Dexie, { type EntityTable } from 'dexie';
import type { Event } from 'nostr-tools';

export interface MessageEvent extends Event {
    relayUrl?: string;
    channel?: string;
}

export const db = new Dexie('coolr') as Dexie & {
    messages: EntityTable<MessageEvent | SystemEvent, 'id'>;
    profiles: EntityTable<ProfileInfo, 'pubkey'>;
}

// 3. Declare your store schema
db.version(1).stores({
    messages: 'id, created_at, pubkey, kind, type, relayUrl, channel',
    profiles: 'pubkey, nip05, name',
});