// Who is signed in, and the latest status of the local AI and their study counts.
// The access token lives only in memory; the refresh token is an HttpOnly cookie.

const listeners = new Set();

export const store = {
  user: null,
  token: null,
  amr: [],
  health: null,
  unread: 0,

  set(patch) {
    Object.assign(this, patch);
    for (const fn of listeners) fn(this);
  },

  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  signedIn() {
    return !!this.user;
  },

  can(permission) {
    if (!this.user) return false;
    return (this.user.permissions || []).includes(permission);
  },

  get role() {
    return this.user ? this.user.role : "guest";
  },
};
