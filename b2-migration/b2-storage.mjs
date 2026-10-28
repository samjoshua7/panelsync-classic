// Native B2 API: secrets never leave the Worker. No S3 delete markers.
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
export class B2Storage {
  constructor(env, fetcher = (...args) => fetch(...args)) { this.env = env; this.fetcher = fetcher; this.auth = null; }
  async authorize() {
    if (this.auth && this.auth.expires > Date.now()) return this.auth;
    if (!this.env.B2_KEY_ID || !this.env.B2_APPLICATION_KEY) throw new Error('B2 credentials missing');
    const response = await this.fetcher('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
      headers: { Authorization: 'Basic ' + btoa(this.env.B2_KEY_ID + ':' + this.env.B2_APPLICATION_KEY) },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('B2 authorization failed (HTTP ' + response.status + ')');
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
    const response = await this.fetcher(auth.apiUrl + '/b2api/v4/' + name, {
      method: 'POST', headers: { Authorization: auth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) { if (response.status === 401) this.auth = null; throw new Error('B2 operation failed'); }
    return response.json();
  }
  async download(key, method, range) {
    const auth = await this.authorize();
    const headers = { Authorization: auth.token };
    if (range) headers.Range = `bytes=${range.offset}-${range.offset + range.length - 1}`;
    const response = await this.fetcher(auth.downloadUrl + '/file/' + encodeURIComponent(this.env.B2_BUCKET_NAME) + '/' + encodePath(key), {
      method, headers, signal: AbortSignal.timeout(45000)
    });
    if (response.status === 404) return null;
    if (!response.ok) { if (response.status === 401) this.auth = null; throw new Error('B2 download failed'); }
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
    if (options.range && response.status !== 206) { await response.body?.cancel(); throw new Error('B2 ignored byte range'); }
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
    if (!response.ok) { await response.body?.cancel(); throw new Error('B2 upload failed'); }
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
