export function formatExpiry(ts: number | null): string {
  if (!ts) return '\u2014';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return 'Expired';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '');
}
