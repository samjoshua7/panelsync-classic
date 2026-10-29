import { authorize } from './auth.mjs';

export function parseKey(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^panelsyncclassic\/[a-z0-9_-]+\/(slides|backgrounds|music)\/[a-zA-Z0-9_.-]+$/.test(value) || value.includes('..')) throw new Error('Invalid media path');
  return { key: value, dept: value.split('/')[1], folder: value.split('/')[2] };
}
export function validType(folder, type) {
  return (folder === 'music' ? ['audio/mpeg', 'audio/wav', 'audio/ogg'] :
    folder === 'backgrounds' ? ['image/jpeg', 'image/png', 'image/webp'] :
      ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']).includes(type);
}
function json(value, status = 200) { return Response.json(value, { status }); }
function origins(env) { return (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean); }
function cors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Size, Range, If-None-Match, If-Range');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}
export async function serveMedia(request, env, key) {
  const meta = await env.MEDIA.head(key);
  if (!meta) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  meta.writeHttpMetadata(headers);
  headers.set('ETag', meta.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public,max-age=31536000,immutable');
  if (request.headers.get('If-None-Match') === meta.httpEtag) return new Response(null, { status: 304, headers });
  let start = 0, end = meta.size - 1, partial = false;
  const range = request.headers.get('Range');
  const ifRange = request.headers.get('If-Range');
  if (range && (!ifRange || ifRange === meta.httpEtag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      headers.set('Content-Range', `bytes */${meta.size}`);
      return new Response(null, { status: 416, headers });
    }
    if (!match[1]) start = Math.max(0, meta.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= meta.size) {
      headers.set('Content-Range', `bytes */${meta.size}`);
      return new Response(null, { status: 416, headers });
    }
    partial = true;
    headers.set('Content-Range', `bytes ${start}-${end}/${meta.size}`);
  }
  headers.set('Content-Length', String(end - start + 1));
  if (request.method === 'HEAD') return new Response(null, { status: partial ? 206 : 200, headers });
  const object = await env.MEDIA.get(key, partial ? { range: { offset: start, length: end - start + 1 } } : {});
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, { status: partial ? 206 : 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    // CORS is a browser policy, not protection against non-browser traffic.
    if (origin && !origins(env).includes(origin)) return new Response('Origin not allowed', { status: 403 });
    const respond = response => origin ? cors(response, origin) : response;
    if (request.method === 'OPTIONS') return respond(new Response(null, { status: 204 }));
    try {
      if (url.pathname.startsWith('/media/') && ['GET', 'HEAD'].includes(request.method)) {
        const { key } = parseKey(decodeURIComponent(url.pathname.slice(7)));
        return respond(await serveMedia(request, env, key));
      }
      if (!['/api/object', '/api/usage'].includes(url.pathname)) return respond(json({ error: 'Not found' }, 404));
      if (url.pathname === '/api/usage' && request.method !== 'GET' || url.pathname === '/api/object' && !['PUT', 'DELETE'].includes(request.method)) return respond(json({ error: 'Method not allowed' }, 405));
      const parsed = url.pathname === '/api/object' ? parseKey(url.searchParams.get('key')) : { dept: url.searchParams.get('dept') };
      if (!/^[a-z0-9_-]+$/.test(parsed.dept || '')) throw new Error('Invalid department');
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
      await authorize(token, parsed.dept, env);
      const stub = env.QUOTA.get(env.QUOTA.idFromName('panelsync-global-quota-v1'));
      // Public requests cannot address the Durable Object directly.
      return respond(await stub.fetch(request));
    } catch (error) {
      const message = ['Invalid media path', 'Invalid department', 'Unauthorized', 'Forbidden', 'Staging database not configured'].includes(error.message) ? error.message : 'Request failed; retry or contact the administrator';
      return respond(json({ error: message }, message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : 400));
    }
  }
};

export class MediaQuota {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async transaction(fn) {
    return this.ctx.storage.transaction(async tx => {
      const state = await tx.get('ledger') || { used: 0, reserved: 0, files: {} };
      const result = await fn(state);
      await tx.put('ledger', state);
      return result;
    });
  }
  async fetch(request) {
    const url = new URL(request.url);
    const limit = Number(this.env.STORAGE_LIMIT_BYTES || 1000000000);
    if (url.pathname === '/api/usage') {
      const state = await this.ctx.storage.get('ledger') || { used: 0, reserved: 0 };
      return json({ usedBytes: state.used, reservedBytes: state.reserved, limitBytes: limit, availableBytes: Math.max(0, limit - state.used - state.reserved) });
    }
    const { key, folder } = parseKey(url.searchParams.get('key'));
    if (request.method === 'DELETE') {
      // Reserve deletion against concurrent mutation; quota is released only after R2 deletion succeeds.
      const found = await this.transaction(state => {
        const entry = state.files[key];
        if (!entry) return false;
        if (entry.state !== 'stored') throw new Error('Object busy');
        entry.state = 'deleting'; return true;
      });
      if (!found) return json({ error: 'Unknown object; refusing untracked deletion' }, 404);
      try {
        await this.env.MEDIA.delete(key);
        await this.transaction(state => { state.used -= state.files[key].size; delete state.files[key]; });
        return json({ deleted: true });
      } catch (e) {
        await this.transaction(state => { state.files[key].state = 'stored'; });
        return json({ error: 'Deletion failed; quota unchanged' }, 503);
      }
    }
    const size = Number(request.headers.get('X-File-Size'));
    const type = request.headers.get('Content-Type');
    if (!Number.isSafeInteger(size) || size <= 0 || size > Number(this.env.MAX_FILE_BYTES || 83886080) || !validType(folder, type)) return json({ error: 'Invalid file size or media type' }, 400);
    const length = request.headers.get('Content-Length');
    if (length !== null && Number(length) !== size) return json({ error: 'Length mismatch' }, 400);
    const reserved = await this.transaction(state => {
      if (state.files[key]) return 'exists';
      if (state.used + state.reserved + size > limit) return 'full';
      state.reserved += size; state.files[key] = { size, state: 'uploading', since: Date.now() };
      return 'ok';
    });
    if (reserved !== 'ok') return json({ error: reserved === 'full' ? 'Storage cap reached' : 'Path already exists; use a new filename' }, reserved === 'full' ? 413 : 409);
    let bytes = 0, stored = false;
    const stream = request.body?.pipeThrough(new TransformStream({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > size) throw new Error('Upload exceeds reserved size');
      controller.enqueue(chunk);
    } }));
    try {
      if (!stream) throw new Error('Missing body');
      // Conditional creation also protects objects imported outside this ledger.
      const object = await this.env.MEDIA.put(key, stream, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: type, cacheControl: 'public,max-age=31536000,immutable' } });
      if (!object) throw new Error('Object already exists');
      stored = true;
      if (bytes !== size) throw new Error('Upload length mismatch');
      await this.transaction(state => { state.reserved -= size; state.used += size; state.files[key].state = 'stored'; });
      return json({ key, url: `${url.origin}/media/${key.split('/').map(encodeURIComponent).join('/')}`, size }, 201);
    } catch (e) {
      // If cleanup cannot be confirmed, keep the reservation: fail closed, never undercount.
      try {
        if (stored) await this.env.MEDIA.delete(key);
        // A failed PUT can be ambiguous: do not free capacity if an object remains.
        if (await this.env.MEDIA.head(key)) throw new Error('Object state needs reconciliation');
        await this.transaction(state => { state.reserved -= size; delete state.files[key]; });
      } catch (cleanupError) { return json({ error: 'Upload interrupted; reservation retained for administrator reconciliation' }, 503); }
      return json({ error: 'Upload failed; no quota consumed' }, 400);
    }
  }
}
