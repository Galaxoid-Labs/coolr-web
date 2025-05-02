// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	interface Window {
		nostr?: WindowNostr;
	}
	interface ProfileInfo {
		pubkey: string;
		nip05?: string;
		name?: string;
	}
	interface SystemEvent {
		type: 'error' | 'info' | 'help';
		created_at: number;
		content: string;
	}
}

export { };
