/**
 * SSE (Server-Sent Events) Emitter Service
 *
 * Manages real-time event streaming for grading progress updates.
 * Provides instant updates to connected clients without polling.
 *
 * Architecture:
 * - Python Worker → HTTP Callback → Elysia → SSE Broadcast → Frontend
 * - One SSE connection per student submission (jobId)
 * - Automatic cleanup when jobs complete
 */

export interface SSEClient {
  jobId: string;
  controller: ReadableStreamDefaultController;
  connectionTime: Date;
}

export class SSEService {
  private clients: Map<string, Set<SSEClient>> = new Map();

  /**
   * Register a new SSE client for a specific job
   */
  addClient(channelId: string, controller: ReadableStreamDefaultController): void {
    if (!this.clients.has(channelId)) {
      this.clients.set(channelId, new Set());
    }

    const client: SSEClient = {
      channelId,
      controller,
      connectionTime: new Date()
    };

    this.clients.get(channelId)!.add(client);
    console.log(`[SSE] Client connected to channel ${channelId}. Total clients: ${this.clients.get(channelId)!.size}`);
  }

  /**
   * Remove a client when they disconnect
   */
  removeClient(channelId: string, controller: ReadableStreamDefaultController): void {
    const channelClients = this.clients.get(channelId);
    if (channelClients) {
      const clientToRemove = Array.from(channelClients).find(c => c.controller === controller);
      if (clientToRemove) {
        channelClients.delete(clientToRemove);
        console.log(`[SSE] Client disconnected from channel ${channelId}. Remaining: ${channelClients.size}`);

        // Clean up if no more clients
        if (channelClients.size === 0) {
          this.clients.delete(channelId);
        }
      }
    }
  }

  /**
   * Send a progress update to all clients watching this job
   * Called when Python worker sends POST /progress callback
   */
  sendProgress(jobId: string, data: {
    message: string;
    current_test?: string;
    tests_completed: number;
    total_tests: number;
    percentage: number;
  }): void {
    const jobClients = this.clients.get(jobId);
    if (!jobClients || jobClients.size === 0) {
      return; // No clients listening
    }

    const eventData = JSON.stringify(data);
    const sseMessage = `event: progress\ndata: ${eventData}\n\n`;

    jobClients.forEach(client => {
      try {
        client.controller.enqueue(new TextEncoder().encode(sseMessage));
      } catch (error) {
        console.error(`[SSE] Failed to send to client:`, error);
        this.removeClient(jobId, client.controller);
      }
    });

    console.log(`[SSE] Progress sent to ${jobClients.size} client(s) for job ${jobId}: ${data.percentage}%`);
  }

  /**
   * Send job started notification
   * Called when Python worker sends POST /started callback
   */
  sendStarted(jobId: string): void {
    const jobClients = this.clients.get(jobId);
    if (!jobClients || jobClients.size === 0) {
      return;
    }

    const sseMessage = `event: started\ndata: ${JSON.stringify({ status: 'running', message: 'Grading started' })}\n\n`;

    jobClients.forEach(client => {
      try {
        client.controller.enqueue(new TextEncoder().encode(sseMessage));
      } catch (error) {
        console.error(`[SSE] Failed to send started event:`, error);
        this.removeClient(jobId, client.controller);
      }
    });

    console.log(`[SSE] Started event sent to ${jobClients.size} client(s) for job ${jobId}`);
  }

  /**
   * Send completion result to all clients watching this job
   * Called when Python worker sends POST /result callback
   */
  sendResult(jobId: string, data: {
    status: string;
    total_points_earned: number;
    total_points_possible: number;
    test_results?: any[];
  }): void {
    const jobClients = this.clients.get(jobId);
    if (!jobClients || jobClients.size === 0) {
      console.log(`[SSE] No clients connected for job ${jobId}, skipping result send`);
      return;
    }

    const eventData = JSON.stringify(data);
    const sseMessage = `event: completed\ndata: ${eventData}\n\n`;

    console.log(`[SSE] Sending result to ${jobClients.size} client(s) for job ${jobId}: ${data.total_points_earned}/${data.total_points_possible} points`);

    jobClients.forEach(client => {
      try {
        // Send the completion event
        client.controller.enqueue(new TextEncoder().encode(sseMessage));

        // Close connection after a delay to ensure message is received
        setTimeout(() => {
          try {
            client.controller.close();
            console.log(`[SSE] Connection closed for client on job ${jobId}`);
          } catch (error) {
            // Ignore errors if already closed
          }
        }, 500); // 500ms delay to ensure browser receives the message
      } catch (error) {
        console.error(`[SSE] Failed to send result to client:`, error);
      }
    });

    // Clean up all clients for this job after delay
    setTimeout(() => {
      this.clients.delete(jobId);
      console.log(`[SSE] Cleaned up clients for job ${jobId}`);
    }, 1000);
  }

  /**
   * Send error event to clients
   */
  sendError(jobId: string, error: string): void {
    const jobClients = this.clients.get(jobId);
    if (!jobClients || jobClients.size === 0) {
      return;
    }

    const sseMessage = `event: error\ndata: ${JSON.stringify({ error, status: 'failed' })}\n\n`;

    jobClients.forEach(client => {
      try {
        client.controller.enqueue(new TextEncoder().encode(sseMessage));
        client.controller.close();
      } catch (e) {
        console.error(`[SSE] Failed to send error:`, e);
      }
    });

    // Clean up
    this.clients.delete(jobId);
  }

  /**
   * Get active connections count
   */
  getActiveConnections(): number {
    let total = 0;
    this.clients.forEach(jobClients => {
      total += jobClients.size;
    });
    return total;
  }

  /**
   * Get jobs being watched
   */
  getWatchedJobs(): string[] {
    return Array.from(this.clients.keys());
  }

  sendEvent(channelId: string, eventName: string, data: any, options?: { close?: boolean }): void {
    const channelClients = this.clients.get(channelId);
    if (!channelClients || channelClients.size === 0) {
      return;
    }

    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

    channelClients.forEach(client => {
      try {
        client.controller.enqueue(new TextEncoder().encode(message));
        if (options?.close) {
          client.controller.close();
        }
      } catch (error) {
        console.error(`[SSE] Failed to send event '${eventName}' on channel ${channelId}:`, error);
        this.removeClient(channelId, client.controller);
      }
    });

    if (options?.close) {
      this.clients.delete(channelId);
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats(): {
    totalConnections: number;
    activeJobs: number;
    jobDetails: Array<{ jobId: string; clients: number; duration: number }>;
  } {
    const now = new Date();
    const jobDetails = Array.from(this.clients.entries()).map(([jobId, clients]) => {
      const oldestClient = Array.from(clients).reduce((oldest, client) => {
        return client.connectionTime < oldest.connectionTime ? client : oldest;
      });

      return {
        jobId,
        clients: clients.size,
        duration: Math.floor((now.getTime() - oldestClient.connectionTime.getTime()) / 1000)
      };
    });

    return {
      totalConnections: this.getActiveConnections(),
      activeJobs: this.clients.size,
      jobDetails
    };
  }
}

// Singleton instance
export const sseService = new SSEService();
