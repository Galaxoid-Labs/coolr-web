export function truncateMiddle(str: string, maxLength = 20) {
	if (str.length <= maxLength) return str;
	const half = Math.floor((maxLength - 3) / 2);
	return str.slice(0, half) + '...' + str.slice(-half);
}

export function formatDate(timestamp: number): string {
	const date = new Date(timestamp * 1000);
	return date.toLocaleString(undefined, {
		weekday: 'short',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
}

export function validChannelName(name: string): boolean {
	const regex = /^(?:[\p{L}\p{N}]{1,12}|_)$/u;
	if (name.length === 1 && name === '_') return true; // Allow single underscore for default channel
	return regex.test(name);
}

export const emoticonMap = new Map([
	[':)', '🙂'],
	[':-)', '🙂'],
	[':(', '🙁'],
	[':-(', '🙁'],
	[':D', '😄'],
	[':-D', '😄'],
	[':P', '😛'],
	[':-P', '😛'],
	[';)', '😉'],
	[':O', '😮'],
	[':-O', '😮'],
	[":'(", '😢'],
	[':3', '😺'],
	['XD', '😆'],
	['B)', '😎'],
	[':|', '😐'],
	[':/', '😕'], // TODO: Pasting in url parses emoji
	[':S', '😖'],
	['>:(', '😠'],
	['O:)', '😇'],
	['<3', '❤️']
]);
