// TEST ONLY. Never deploy this fake-B2 Worker to Cloudflare.
import { MediaQuota as Quota, serveMedia } from '../quota-worker.mjs';
import { B2Storage } from '../b2-storage.mjs';
const objects = new Map();
let sequence = 0;
async function fakeB2(url, options) {
  if (url.includes('b2_authorize_account')) return Response.json({ authorizationToken: 'token', apiInfo: { storageApi: {
    apiUrl: 'https://api001.backblazeb2.com', downloadUrl: 'https://f001.backblazeb2.com',
    allowed: { buckets: [{ id: 'id', name: 'bucket' }], capabilities: ['readFiles', 'writeFiles', 'deleteFiles'] }
  } } });
  if (url.includes('b2_get_upload_url')) return Response.json({ uploadUrl: 'https://pod-001.backblazeb2.com/upload', authorizationToken: 'upload-token' });
  if (url.includes('/upload')) {
    const bytes = new Uint8Array(await new Response(options.body).arrayBuffer());
    const name = decodeURIComponent(options.headers['X-Bz-File-Name']);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== options.headers['X-Bz-Content-Sha1']) return new Response('Checksum mismatch', { status: 400 });
    const fileId = 'version-' + (++sequence);
    objects.set(name, { bytes, fileId });
    return Response.json({ fileName: name, fileId, contentLength: bytes.length, contentSha1: hash });
  }
  if (url.includes('b2_delete_file_version')) { objects.delete(JSON.parse(options.body).fileName); return Response.json({}); }
  const name = decodeURIComponent(new URL(url).pathname.slice('/file/bucket/'.length));
  const object = objects.get(name);
  if (!object) return new Response(null, { status: 404 });
  const headers = { 'Content-Length': String(object.bytes.length), 'Content-Type': 'video/mp4', 'X-Bz-File-Id': object.fileId };
  if (options.method === 'HEAD') return new Response(null, { headers });
  const range = options.headers.Range?.match(/^bytes=(\d+)-(\d+)$/);
  const body = range ? object.bytes.slice(Number(range[1]), Number(range[2]) + 1) : object.bytes;
  headers['Content-Length'] = String(body.length);
  return new Response(body, { status: range ? 206 : 200, headers });
}
function storage() { return new B2Storage({ B2_KEY_ID: 'id', B2_APPLICATION_KEY: 'secret', B2_BUCKET_ID: 'id', B2_BUCKET_NAME: 'bucket' }, fakeB2); }
export class MediaQuota extends Quota { constructor(ctx, env) { super(ctx, { ...env, MEDIA: storage() }); } }
export default { fetch(request) { return serveMedia(request, { MEDIA: storage() }, new URL(request.url).pathname.slice(1)); } };
