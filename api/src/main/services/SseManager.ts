import { Response } from 'express';

class SseManager {
  private clients: Map<string, Response> = new Map();

  addClient(userId: string, res: Response): void {
    this.clients.set(userId, res);
  }

  removeClient(userId: string): void {
    this.clients.delete(userId);
  }

  sendToUser(userId: string, event: string, data: any): void {
    const client = this.clients.get(userId);
    if (client && !client.destroyed) {
      client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  isConnected(userId: string): boolean {
    return this.clients.has(userId);
  }

  getConnectedCount(): number {
    return this.clients.size;
  }
}

// Singleton instance
const sseManager = new SseManager();
export default sseManager;
