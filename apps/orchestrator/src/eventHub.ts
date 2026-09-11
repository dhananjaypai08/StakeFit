import type { ScanEvent } from "@stakefit/shared";
import type { WebSocket } from "ws";

/**
 * Fan out scan events to any frontend clients subscribed to a scanId. Events are
 * buffered so a client that connects mid-scan still receives the backlog.
 */
export class EventHub {
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly backlog = new Map<string, ScanEvent[]>();
  private readonly frames = new Map<string, Buffer>();
  private readonly frameWaiters = new Map<string, Set<(frame: Buffer) => void>>();

  subscribe(scanId: string, socket: WebSocket): void {
    if (!this.clients.has(scanId)) this.clients.set(scanId, new Set());
    this.clients.get(scanId)!.add(socket);
    for (const event of this.backlog.get(scanId) ?? []) {
      this.send(socket, event);
    }
  }

  unsubscribe(scanId: string, socket: WebSocket): void {
    this.clients.get(scanId)?.delete(socket);
  }

  publish(event: ScanEvent): void {
    if (event.type === "browser.frame") {
      this.pushFrame(event.scanId, Buffer.from(event.jpegBase64, "base64"));
      return;
    }

    const list = this.backlog.get(event.scanId) ?? [];
    list.push(event);
    // Cap backlog to avoid unbounded growth on long scans.
    if (list.length > 2000) list.shift();
    this.backlog.set(event.scanId, list);

    for (const socket of this.clients.get(event.scanId) ?? []) {
      this.send(socket, event);
    }
  }

  latestFrame(scanId: string): Buffer | undefined {
    return this.frames.get(scanId);
  }

  waitForFrame(scanId: string, timeoutMs = 800): Promise<Buffer | undefined> {
    const current = this.frames.get(scanId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.frameWaiters.get(scanId)?.delete(onFrame);
        resolve(this.frames.get(scanId) ?? current);
      }, timeoutMs);
      const onFrame = (frame: Buffer) => {
        clearTimeout(timer);
        this.frameWaiters.get(scanId)?.delete(onFrame);
        resolve(frame);
      };
      if (!this.frameWaiters.has(scanId)) this.frameWaiters.set(scanId, new Set());
      this.frameWaiters.get(scanId)!.add(onFrame);
    });
  }

  private pushFrame(scanId: string, frame: Buffer): void {
    this.frames.set(scanId, frame);
    for (const waiter of this.frameWaiters.get(scanId) ?? []) waiter(frame);
  }

  private send(socket: WebSocket, event: ScanEvent): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(event));
    }
  }
}
