import { HttpClient } from '../HttpClient';

export class UserManagement {
  protected client: HttpClient = new HttpClient({
    baseUrl: 'https://api.workos.com',
    credentials: 'include',
  });
}
