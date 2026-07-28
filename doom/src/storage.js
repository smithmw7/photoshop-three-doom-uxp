const memoryStorage = new Map();

export const doomStorage = {
  getItem(key) {
    try {
      const value = window.localStorage.getItem(key);
      if (value !== null) {
        return value;
      }
    } catch (error) {
      // Local UXP WebView content intentionally has no localStorage access.
    }
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
  },

  setItem(key, value) {
    const stringValue = String(value);
    memoryStorage.set(key, stringValue);
    try {
      window.localStorage.setItem(key, stringValue);
    } catch (error) {
      // Keep the in-memory value for this WebView session.
    }
  },

  removeItem(key) {
    memoryStorage.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // The in-memory entry is already removed.
    }
  }
};
