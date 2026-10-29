/* Durable, visible cleanup. Independent services cannot share a transaction. */
(function (root) {
    root.PanelMediaManagement = function (db, storage, dept) {
        const base = 'dept/' + dept + '/';
        let processing = false;
        async function read(node) { return (await db.ref(base + node).once('value')).val(); }
        async function referenced(path) {
            const values = await Promise.all(['media', 'disabled_media', 'background', 'music'].map(read));
            return values.some((value, index) => index < 2 ? Object.values(value || {}).some(item => item.storagePath === path) : value && value.storagePath === path);
        }
        async function retry() {
            if (processing) return;
            processing = true;
            try {
                const jobs = await read('cleanup_jobs') || {};
                for (const [id, job] of Object.entries(jobs)) {
                    if (job.uploadUntil && job.uploadUntil > Date.now()) continue;
                    try {
                        // Shared media must remain until its final reference is removed.
                        if (job.storagePath && !(await referenced(job.storagePath))) await storage.ref(job.storagePath).delete();
                        await db.ref(base + 'cleanup_jobs/' + id).remove();
                    } catch (error) {
                        await db.ref(base + 'cleanup_jobs/' + id).update({ error: error.message, lastAttempt: Date.now() });
                    }
                }
            } finally { processing = false; }
        }
        async function remove(node, id, item) {
            if (!['media', 'disabled_media', 'background', 'music'].includes(node)) throw new Error('Invalid media node');
            const updates = {};
            const target = base + node + (id ? '/' + id : '');
            updates[target] = null;
            if (id) {
                updates[base + 'media/' + id] = null;
                updates[base + 'disabled_media/' + id] = null;
            }
            let jobId;
            if (item && item.storagePath) {
                jobId = db.ref(base + 'cleanup_jobs').push().key;
                updates[base + 'cleanup_jobs/' + jobId] = { storagePath: item.storagePath, createdAt: Date.now(), reason: 'Deleted ' + node };
            }
            // Stop displaying and persist the cleanup obligation atomically.
            await db.ref().update(updates);
            await retry();
            if (jobId && (await db.ref(base + 'cleanup_jobs/' + jobId).once('value')).exists()) throw new Error('Removed from playlist; storage cleanup is pending. Use Retry cleanup.');
        }
        async function replace(node, item) {
            const previous = await read(node);
            const updates = { [base + node]: item };
            const jobs = await read('cleanup_jobs') || {};
            for (const [id, job] of Object.entries(jobs)) if (job.storagePath === item.storagePath) updates[base + 'cleanup_jobs/' + id] = null;
            if (previous && previous.storagePath && previous.storagePath !== item.storagePath) {
                const id = db.ref(base + 'cleanup_jobs').push().key;
                updates[base + 'cleanup_jobs/' + id] = { storagePath: previous.storagePath, createdAt: Date.now(), reason: 'Replaced ' + node };
            }
            try { await db.ref().update(updates); }
            catch (error) {
                // A lost response is not proof that the database write failed.
                // Never roll back bytes that might already be published.
                let observed;
                try { observed = await read(node); }
                catch { throw new Error('Publication outcome uncertain; keep the file and retry cleanup when connected.'); }
                if (observed && observed.storagePath === item.storagePath) { await retry(); return; }
                // Best-effort rollback of this new upload. If unavailable, report
                // the path rather than claiming successful publication/cleanup.
                try { await storage.ref(item.storagePath).delete(); }
                catch { throw new Error('Publish and rollback failed. Unpublished file needs cleanup: ' + item.storagePath); }
                throw error;
            }
            await retry();
        }
        async function publish(id, item) {
            const updates = { [base + 'media/' + id]: item };
            const jobs = await read('cleanup_jobs') || {};
            for (const [jobId, job] of Object.entries(jobs)) if (job.storagePath === item.storagePath) updates[base + 'cleanup_jobs/' + jobId] = null;
            try { await db.ref().update(updates); }
            catch (error) {
                let observed;
                try { observed = (await db.ref(base + 'media/' + id).once('value')).val(); }
                catch { throw new Error('Publication outcome uncertain; upload tracking is retained for reconciliation.'); }
                if (observed && observed.storagePath === item.storagePath) return;
                try { await storage.ref(item.storagePath).delete(); }
                catch {
                    const job = db.ref(base + 'cleanup_jobs').push();
                    await job.set({ storagePath: item.storagePath, createdAt: Date.now(), reason: 'Publish failed', error: 'Unpublished upload needs cleanup' });
                    throw new Error('Publish failed; uploaded file queued for cleanup.');
                }
                throw error;
            }
        }
        async function stage(storagePath) {
            const job = db.ref(base + 'cleanup_jobs').push();
            await job.set({ storagePath, createdAt: Date.now(), uploadUntil: Date.now() + 15 * 60 * 1000, reason: 'Upload awaiting publication' });
        }
        return { remove, replace, publish, retry, stage };
    };
})(window);
