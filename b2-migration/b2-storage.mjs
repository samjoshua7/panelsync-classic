// Native B2 API: secrets never leave the Worker. No S3 delete markers.
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
// Only read-like operations use this helper. Never replay an upload or deletion
// automatically: a lost response can conceal a committed write.
async function retryRead(operation) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await operation();
      if (attempt === 0 && response.status >= 500) { await response.body?.cancel(); continue; }
      return response;
    } catch (error) {
      if (attempt === 1 || !['TypeError', 'AbortError', 'TimeoutError'].includes(error.name)) throw error;
    }
  }
}
async function failure(response, operation) {
  const data = await response.json().catch(() => ({}));
  const code = /^[a-z0-9_]+$/.test(data.code || '') ? data.code : 'unknown';
  const error = new Error('B2 ' + operation + ' failed (HTTP ' + response.status + ', ' + code + ')');
  error.retryable = response.status >= 500;
  return error;
}
export class B2Storage {
  constructor(env, fetcher = (...args) => fetch(...args)) { this.env = env; this.fetcher = fetcher; this.auth = null; }
  async authorize() {
    if (this.auth && this.auth.expires > Date.now()) return this.auth;
    if (!this.env.B2_KEY_ID || !this.env.B2_APPLICATION_KEY) throw new Error('B2 credentials missing');
    const response = await retryRead(() => this.fetcher('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
      headers: { Authorization: 'Basic ' + btoa(this.env.B2_KEY_ID + ':' + this.env.B2_APPLICATION_KEY) },
      signal: AbortSignal.timeout(15000)
    }));
    if (!response.ok) throw await failure(response, 'authorization');
    const data = await response.json(), api = data.apiInfo?.storageApi;
    if (!api?.apiUrl || !api.downloadUrl || !data.authorizationToken) throw new Error('Invalid B2 authorization');
    // Require a bucket-restricted key; never accept an account-wide/master key.
    const buckets = api.allowed?.buckets;
    if (!Array.isArray(buckets) || buckets.length !== 1 || buckets[0].id !== this.env.B2_BUCKET_ID || (buckets[0].name != null && buckets[0].name !== this.env.B2_BUCKET_NAME)) throw new Error('B2 key must be restricted to the configured bucket');
    for (const cap of ['readFiles', 'writeFiles', 'deleteFiles']) {
      if (!api.allowed.capabilities?.includes(cap)) throw new Error('B2 key missing required capability');
    }
    for (const base of [api.apiUrl, api.downloadUrl]) {
      if (!/^https:\/\/[a-z0-9.-]+\.backblazeb2\.com$/.test(base)) throw new Error('Invalid B2 host');
    }
    this.auth = { ...api, token: data.authorizationToken, expires: Date.now() + 3600000 };
    return this.auth;
  }
  async api(name, body) {
    const auth = await this.authorize();
    const operation = () => this.fetcher(auth.apiUrl + '/b2api/v4/' + name, {
      method: 'POST', headers: { Authorization: auth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const response = name === 'b2_get_upload_url' ? await retryRead(operation) : await operation();
    if (!response.ok) { if (response.status === 401) this.auth = null; throw await failure(response, 'operation'); }
    return response.json();
  }
  async download(key, method, range) {
    const auth = await this.authorize();
    const headers = { Authorization: auth.token };
    if (range) headers.Range = `bytes=${range.offset}-${range.offset + range.length - 1}`;
    // Bound the wait for B2 response headers, not the complete video transfer.
    // A fixed whole-response deadline would cut off otherwise healthy playback
    // on a slow TV connection. The display already guards stalled playback.
    const response = await retryRead(async () => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await this.fetcher(auth.downloadUrl + '/file/' + encodeURIComponent(this.env.B2_BUCKET_NAME) + '/' + encodePath(key), {
        method, headers, signal: controller.signal
      });
    } finally { clearTimeout(deadline); }
    return response;
    });
    if (response.status === 404) return null;
    if (!response.ok) { if (response.status === 401) this.auth = null; throw await failure(response, 'download'); }
    return response;
  }
  async head(key) {
    const response = await this.download(key, 'HEAD');
    if (!response) return null;
    const size = Number(response.headers.get('Content-Length'));
    const fileId = response.headers.get('X-Bz-File-Id');
    if (!Number.isSafeInteger(size) || size <= 0 || !fileId) throw new Error('Invalid B2 metadata');
    // Version ID is a stable validator even for files lacking a B2 content hash.
    return { size, fileId, httpEtag: '"' + fileId + '"', writeHttpMetadata(headers) {
      headers.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
    } };
  }
  async get(key, options = {}) {
    const response = await this.download(key, 'GET', options.range);
    if (!response) return null;
    if (options.range && response.status !== 206) {
      // B2 may return 200 when the requested range covers the entire file.
      // It is safe to wrap that body as 206 only with an exact length match.
      const wholeRange = response.status === 200 && options.range.offset === 0 &&
        Number(response.headers.get('Content-Length')) === options.range.length;
      if (!wholeRange) { await response.body?.cancel(); throw new Error('B2 ignored byte range'); }
    }
    return { body: response.body };
  }
  async put(key, stream, options) {
    // The quota ledger serializes reservations for this key. This also protects
    // files created outside this app: external writers must not share its prefix.
    if (await this.head(key)) return null;
    const upload = await this.api('b2_get_upload_url', { bucketId: this.env.B2_BUCKET_ID });
    if (!/^https:\/\/[a-z0-9.-]+\.backblaze(b2)?\.com\//.test(upload.uploadUrl)) throw new Error('Invalid B2 upload host');
    const size = options.size, sha1 = options.sha1;
    if (!/^[a-f0-9]{40}$/.test(sha1 || '')) throw new Error('Missing upload checksum');
    // FixedLengthStream gives Workers fetch a real Content-Length without
    // buffering a complete video inside the Worker's 128 MB memory budget.
    const fixed = new FixedLengthStream(size);
    const piping = stream.pipeTo(fixed.writable);
    piping.catch(() => {});
    const response = await this.fetcher(upload.uploadUrl, {
      method: 'POST', headers: {
        Authorization: upload.authorizationToken, 'Content-Length': String(size),
        'Content-Type': options.httpMetadata.contentType,
        'X-Bz-File-Name': encodeURIComponent(key), 'X-Bz-Content-Sha1': sha1
      }, body: fixed.readable, duplex: 'half', signal: AbortSignal.timeout(600000)
    });
    if (!response.ok) throw await failure(response, 'upload');
    await piping;
    const result = await response.json();
    if (result.fileName !== key || result.contentLength !== size || result.contentSha1 !== sha1 || !result.fileId) throw new Error('B2 upload verification failed');
    return result;
  }
  async delete(key) {
    const meta = await this.head(key);
    if (!meta) return;
    // Actually delete this version. S3 DELETE would leave a billable version.
    await this.api('b2_delete_file_version', { fileName: key, fileId: meta.fileId });
    if (await this.head(key)) throw new Error('Additional versions remain; quota retained');
  }
}
