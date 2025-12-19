import api from './api';

export interface KindleAccountStatus {
  isConnected: boolean;
  email?: string;
  marketplace?: string;
  lastSyncedAt?: string;
  lastSyncError?: string;
  totalBooks: number;
}

export interface KindleSyncResult {
  success: boolean;
  booksAdded: number;
  booksUpdated: number;
  progressSynced: number;
  errorMessage?: string;
  errors: string[];
}

export interface ConnectKindleRequest {
  email: string;
  sessionCookies: string;
  marketplace?: string;
}

class KindleService {
  async getStatus(): Promise<KindleAccountStatus> {
    const response = await api.get<KindleAccountStatus>('/api/kindle/status');
    return response.data;
  }

  async connectAccount(data: ConnectKindleRequest): Promise<void> {
    await api.post('/api/kindle/connect', data);
  }

  async validateCookies(sessionCookies: string, marketplace?: string): Promise<boolean> {
    const response = await api.post<{ valid: boolean }>('/api/kindle/validate-cookies', {
      sessionCookies,
      marketplace: marketplace || 'com'
    });
    return response.data.valid;
  }

  async disconnectAccount(): Promise<void> {
    await api.delete('/api/kindle/disconnect');
  }

  async syncLibrary(): Promise<KindleSyncResult> {
    const response = await api.post<KindleSyncResult>('/api/kindle/sync');
    return response.data;
  }

  async syncProgress(bookId: string): Promise<void> {
    await api.post(`/api/kindle/sync/progress/${bookId}`);
  }

  async pushProgress(bookId: string, position: number): Promise<void> {
    await api.post(`/api/kindle/push/progress/${bookId}`, { position });
  }
}

export default new KindleService();
