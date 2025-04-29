export function truncateMiddle(str: string, maxLength = 20) {
    if (str.length <= maxLength) return str;
    const half = Math.floor((maxLength - 3) / 2);
    return str.slice(0, half) + '...' + str.slice(-half);
}

export function linkify(text: string): string {
    const urlRegex = /((https?:\/\/[^\s]+))/g;
    return text.replace(
        urlRegex,
        '<a class="hover:underline text-white" href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

export function formatDate(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString(undefined, {
        month: undefined,
        day: undefined,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}