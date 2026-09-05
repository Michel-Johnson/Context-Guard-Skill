import { fail, MAX_MESSAGE_BYTES, validateMessage } from './protocol.mjs';

// SSE is only a hint. Independent heartbeats remain responsible for catching gaps.
export async function readEvents(origin, credential, { signal, onEvent, fetcher = fetch, allowLoopback = false, idleMs = 25000 }) {
  const base = new URL(origin);
  if (base.username || base.password || (base.protocol !== 'https:' && !(allowLoopback && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) fail('FORBIDDEN', 'Invalid event transport origin');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timer, reader;
  const renew = () => { clearTimeout(timer); timer = setTimeout(abort, idleMs); timer.unref?.(); };
  try {
    renew();
    const response = await fetcher(new URL('/api/v2/events', base), { redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${credential}`, Accept: 'text/event-stream' } });
    if (response.status === 401) fail('UNAUTHORIZED', 'Connection expired');
    if (response.status === 403) fail('FORBIDDEN', 'Connection is not authorized');
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) fail('UNAVAILABLE', 'Event stream unavailable');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '', data = [], size = 0;
    while (!controller.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      renew(); pending += decoder.decode(chunk.value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
        if (!line) {
          if (data.length) {
            let message;
            try { message = JSON.parse(data.join('\n')); } catch { fail('UNAVAILABLE', 'Malformed event hint'); }
            validateMessage(message);
            if (message.type !== 'sync.event') fail('UNAVAILABLE', 'Unexpected event hint');
            await onEvent(message);
          }
          data = []; size = 0;
        } else if (line.startsWith('data:')) {
          const value = line.slice(5).replace(/^ /, ''); size += Buffer.byteLength(value);
          if (size > MAX_MESSAGE_BYTES) fail('TOO_LARGE', 'Event hint exceeds limit');
          data.push(value);
        }
      }
      if (Buffer.byteLength(pending) + size > MAX_MESSAGE_BYTES) fail('TOO_LARGE', 'Event hint exceeds limit');
    }
    if (!signal?.aborted) fail('UNAVAILABLE', 'Event stream ended; heartbeat will recover missed changes');
  } finally {
    clearTimeout(timer); controller.abort();
    signal?.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
  }
}
