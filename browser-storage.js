/* Firebase-authenticated B2 gateway adapter. No storage credentials in browser. */
(function (root) {
  root.PanelB2Storage = function (auth, endpoint) {
    endpoint = endpoint.replace(/\/$/, '');
    async function token() {
      if (!auth.currentUser) {
        await new Promise((resolve, reject) => {
          const unsubscribe = auth.onAuthStateChanged(user => {
            unsubscribe();
            if (user) resolve(); else reject(new Error('Please sign in to the staging admin again.'));
          }, reject);
        });
      }
      return auth.currentUser.getIdToken();
    }
    async function usage() {
      const dept = new URLSearchParams(location.search).get('dept');
      if (!dept) return;
      const response = await fetch(endpoint + '/api/usage?dept=' + encodeURIComponent(dept), { headers: { Authorization: 'Bearer ' + await token() } });
      if (!response.ok) throw new Error('Storage usage unavailable');
      const data = await response.json();
      let el = document.getElementById('b2StorageUsage');
      if (!el) {
        el = document.createElement('p'); el.id = 'b2StorageUsage';
        el.style.cssText = 'padding:0.75rem;text-align:center;font:inherit;';
        (document.querySelector('[data-backend-details]') || document.querySelector('aside')).append(el);
      }
      el.textContent = 'B2 storage (all departments): ' + (data.usedBytes / 1000000).toFixed(1) +
        ' MB used + ' + (data.reservedBytes / 1000000).toFixed(1) + ' MB uploading / ' +
        (data.limitBytes / 1000000).toFixed(0) + ' MB cap';
    }
    const storage = {
      ref(path) {
        const url = endpoint + '/api/object?key=' + encodeURIComponent(path);
        return {
          put(file) {
            const task = { snapshot: null };
            task.on = function (event, progress, failure, complete) {
              (async () => {
                const idToken = await token();
                const digest = await crypto.subtle.digest('SHA-1', await file.arrayBuffer());
                const sha1 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
                const result = await new Promise((resolve, reject) => {
                  const xhr = new XMLHttpRequest();
                  xhr.open('PUT', url); xhr.timeout = 600000;
                  xhr.setRequestHeader('Authorization', 'Bearer ' + idToken);
                  xhr.setRequestHeader('Content-Type', file.type);
                  xhr.setRequestHeader('X-File-Size', String(file.size));
                  xhr.setRequestHeader('X-Content-Sha1', sha1);
                  xhr.upload.onprogress = event => progress({ bytesTransferred: event.loaded, totalBytes: event.total || file.size });
                  xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error('B2 upload interrupted; check storage usage before retrying.'));
                  xhr.onload = () => {
                    let data;
                    try { data = JSON.parse(xhr.responseText); } catch (e) { reject(new Error('Invalid B2 response')); return; }
                    if (xhr.status === 201) resolve(data);
                    else reject(new Error(data.error || 'B2 upload failed'));
                  };
                  xhr.send(file);
                });
                task.snapshot = { ref: { getDownloadURL: () => Promise.resolve(result.url) } };
                progress({ bytesTransferred: file.size, totalBytes: file.size });
                complete(); usage().catch(() => {});
              })().catch(error => { failure(error); usage().catch(() => {}); });
            };
            return task;
          },
          async delete() {
            const response = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + await token() } });
            if (response.status === 404) {
              const head = await fetch(endpoint + '/media/' + path.split('/').map(encodeURIComponent).join('/'), {method:'HEAD', cache:'no-store'});
              if (head.status !== 404) throw new Error('Untracked B2 file remains; administrator reconciliation required.');
            } else if (!response.ok) throw new Error('B2 deletion failed; cleanup remains pending.');
            usage().catch(() => {});
          }
        };
      }
    };
    auth.onAuthStateChanged(user => { if (user) usage().catch(() => {}); });
    return storage;
  };
})(window);
