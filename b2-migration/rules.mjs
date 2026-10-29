// Generate destination-only rules. Never deploy these to the running source project.
export function destinationRules() {
  const key = "auth.token.email.toLowerCase().replace('.', '_').replace('@', '_')";
  const signed = "auth != null && auth.token.email_verified === true";
  const global = `root.child('users').child(${key})`;
  const member = `root.child('dept').child($dept).child('users').child(${key})`;
  const active = record => `(${record}.child('active').val() === true && ${record}.child('email').val().toLowerCase() === auth.token.email.toLowerCase())`;
  const superUser = `(${active(global)} && ${global}.child('roleLevel').val() === 3)`;
  const editor = `${signed} && (${superUser} || (${active(member)} && ${member}.child('roleLevel').val() >= 1))`;
  const manager = `${signed} && (${superUser} || (${active(member)} && ${member}.child('roleLevel').val() === 2))`;
  const content = { '.read': true, '.write': editor };
  return { rules: {
    '.read': false, '.write': false,
    depts: { '.read': true, '.write': `${signed} && ${superUser}` },
    users: { '.read': `${signed} && ${superUser}`, '.write': `${signed} && ${superUser}`,
      '$user': { '.read': `${signed} && $user === ${key}` }
    },
    dept: { '$dept': {
      media: { ...content, '.indexOn': ['order'] },
      disabled_media: { '.read': editor, '.write': editor, '.indexOn': ['order'] },
      settings: content, background: content, music: content,
      cleanup_jobs: { '.read': editor, '.write': editor },
      users: { '.read': manager, '.write': manager,
        '$user': { '.read': `${signed} && $user === ${key}`, '.validate': "newData.hasChildren(['email', 'roleLevel', 'active']) && newData.child('email').isString() && newData.child('active').isBoolean() && (newData.child('roleLevel').val() === 1 || newData.child('roleLevel').val() === 2)" }
      }
    } }
  } };
}
