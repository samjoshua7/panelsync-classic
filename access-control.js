/* Identity and membership, not sessionStorage, are authoritative. */
(function (root) {
    function key(email) { return email.toLowerCase().replace(/\./g, '_').replace(/@/g, '_'); }
    function active(record, email) { return record && record.active === true && record.email.toLowerCase() === email; }
    function normalizeDept(value) {
        value = (value || '').trim().toLowerCase();
        return /^(null|undefined)$/.test(value) || !/^[a-z0-9_-]+$/.test(value) ? null : value;
    }
    async function resolve(auth, db, selected) {
        selected = normalizeDept(selected);
        const user = await new Promise((resolve, reject) => {
            let stop;
            stop = auth.onAuthStateChanged(value => { if (stop) stop(); resolve(value); }, reject);
        });
        if (!user || !user.emailVerified || !user.email) throw new Error('Sign in with your authorized Google account.');
        const email = user.email.toLowerCase(), userKey = key(email);
        const global = (await db.ref('users/' + userKey).once('value')).val();
        const superAdmin = active(global, email) && global.roleLevel === 3;
        const depts = (await db.ref('depts').once('value')).val() || {};
        const roles = {};
        await Promise.all(Object.keys(depts).map(async dept => {
            if (superAdmin) { roles[dept] = 3; return; }
            const member = (await db.ref('dept/' + dept + '/users/' + userKey).once('value')).val();
            if (active(member, email) && [1, 2].includes(member.roleLevel)) roles[dept] = member.roleLevel;
        }));
        if (selected && depts[selected] && !roles[selected]) throw new Error('Your email is not authorized for this department.');
        if (!superAdmin && !Object.keys(roles).length) throw new Error('No active department membership. Contact your administrator.');
        return { email, userKey, superAdmin, depts, roles, role: selected ? roles[selected] : (superAdmin ? 3 : 0) };
    }
    root.PanelAccess = { resolve, key, normalizeDept };
})(window);
