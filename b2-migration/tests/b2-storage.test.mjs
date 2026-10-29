import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B2Storage } from '../b2-storage.mjs';
const env = { B2_KEY_ID: 'id', B2_APPLICATION_KEY: 'secret', B2_BUCKET_ID: 'bucket-id', B2_BUCKET_NAME: 'bucket' };
export function authorization(buckets = [{ id: 'bucket-id', name: 'bucket' }]) {
  return { authorizationToken: 'private-token', apiInfo: { storageApi: {
    apiUrl: 'https://api001.backblazeb2.com', downloadUrl: 'https://f001.backblazeb2.com',
    allowed: { buckets, capabilities: ['readFiles', 'writeFiles', 'deleteFiles'] }
  } } };
}
test('B2 rejects unrestricted or wrong-bucket credentials and caches valid auth', async () => {
  for (const buckets of [null, [], [{ id: 'other', name: 'other' }]]) {
    const client = new B2Storage(env, async () => Response.json(authorization(buckets)));
    await assert.rejects(client.authorize());
  }
  let requests = 0;
  const client = new B2Storage(env, async () => { requests++; return Response.json(authorization()); });
  await client.authorize(); await client.authorize(); assert.equal(requests, 1);
  const hiddenName = new B2Storage(env, async () => Response.json(authorization([{ id: 'bucket-id', name: null }])));
  await hiddenName.authorize();
});
test('B2 deletion deletes the concrete version, refuses to release older versions', async () => {
  let deleted = false, deleteBody;
  const client = new B2Storage(env, async (url, options) => {
    if (url.includes('b2_authorize_account')) return Response.json(authorization());
    if (url.includes('b2_delete_file_version')) {
      deleted = true; deleteBody = JSON.parse(options.body); return Response.json({ fileId: 'version-1' });
    }
    assert.equal(options.method, 'HEAD');
    return deleted ? new Response(null, { status: 404 }) : new Response(null, { headers: { 'Content-Length': '6', 'X-Bz-File-Id': 'version-1' } });
  });
  await client.delete('panelsyncclassic/cse/slides/a.mp4');
  assert.deepEqual(deleteBody, { fileName: 'panelsyncclassic/cse/slides/a.mp4', fileId: 'version-1' });
  client.head = async () => ({ fileId: 'older-version' });
  await assert.rejects(client.delete('panelsyncclassic/cse/slides/a.mp4'), /Additional versions/);
});
test('B2 private downloads keep credentials server-side and enforce byte range response', async () => {
  const client = new B2Storage(env, async (url, options) => {
    if (url.includes('b2_authorize_account')) return Response.json(authorization());
    assert.equal(options.headers.Authorization, 'private-token');
    assert.equal(options.headers.Range, 'bytes=2-4');
    assert.ok(!url.includes('private-token'));
    return new Response('234', { status: 206 });
  });
  assert.equal(await new Response((await client.get('a', { range: { offset: 2, length: 3 } })).body).text(), '234');
  client.download = async () => new Response('whole-file');
  await assert.rejects(client.get('a', { range: { offset: 2, length: 3 } }), /ignored byte range/);
});

test('B2 200 for a complete-object range is accepted only with exact length', async () => {
  const client = new B2Storage(env);
  client.download = async () => new Response('012345', { headers: { 'Content-Length': '6' } });
  assert.equal(await new Response((await client.get('a', {range:{offset:0,length:6}})).body).text(), '012345');
  await assert.rejects(client.get('a', {range:{offset:0,length:3}}), /ignored byte range/);
  await assert.rejects(client.get('a', {range:{offset:1,length:6}}), /ignored byte range/);
  client.download = async () => new Response('012345');
  await assert.rejects(client.get('a', {range:{offset:0,length:6}}), /ignored byte range/);
});
