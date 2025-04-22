import type { SessionStorage } from '../../core/session/types.js';
export class ChromeExtensionStorage implements SessionStorage<void, void> {
  cookieName: string;
  domain: string;

  constructor(domain: string, cookeName = 'wos-session') {
    this.cookieName = cookeName;
    this.domain = domain;
  }

  async getSession(): Promise<string | null> {
    const cookie = await chrome.cookies.get({
      name: this.cookieName,
      url: this.domain,
    });
    return cookie?.value ?? null;
  }

  async saveSession(_: unknown, sessionData: string): Promise<void> {
    await chrome.cookies.set({
      name: this.cookieName,
      url: this.domain,
      value: sessionData,
      expirationDate: Date.now() / 1000 + 60 * 60 * 24 * 400, // 400 days
    });
  }

  async clearSession(): Promise<void> {
    await chrome.cookies.remove({
      name: this.cookieName,
      url: this.domain,
    });
  }
}
