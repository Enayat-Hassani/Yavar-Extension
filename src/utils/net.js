// Network helpers shared by the side panel agents.

// The research agent's READ targets are chosen by the AI, which can be steered
// by text on pages it has read. Only allow public http(s) pages so it can never
// reach localhost, the LAN, or cloud metadata endpoints.
export function isPublicWebUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;

  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (!h.includes('.') && !h.includes(':')) return false; // bare intranet names

  // IPv4 loopback, private, link-local, CGNAT and "this network" ranges
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }

  // IPv6 loopback/unspecified, unique-local, link-local, IPv4-mapped
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return false;
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return false;
    if (h.startsWith('::ffff:')) return false;
  }
  return true;
}
