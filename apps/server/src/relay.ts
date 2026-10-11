import type { ClientRole, Message } from '@ble-bridge/shared';
import { serializeMessage } from '@ble-bridge/shared';

/** The smallest surface the relay needs from a socket. Lets tests use plain objects. */
export interface RelaySocket {
  readonly isOpen: boolean;
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface Peer {
  id: string;
  role: ClientRole;
  socket: RelaySocket;
}

/**
 * Pure in-memory relay. Knows nothing about ws, http, or the network.
 * Everything here is synchronous and testable with fake sockets.
 */
export class Relay {
  private readonly peers = new Map<string, Peer>();
  private nextId = 1;

  add(role: ClientRole, socket: RelaySocket): Peer {
    const peer: Peer = { id: `c${this.nextId++}`, role, socket };
    this.peers.set(peer.id, peer);
    return peer;
  }

  remove(id: string): void {
    this.peers.delete(id);
  }

  size(): number {
    return this.peers.size;
  }

  /** Send a message to every open peer except the sender. Returns how many received it. */
  broadcast(fromId: string, message: Message): number {
    const data = serializeMessage(message);
    let delivered = 0;
    for (const peer of this.peers.values()) {
      if (peer.id === fromId || !peer.socket.isOpen) continue;
      peer.socket.send(data);
      delivered++;
    }
    return delivered;
  }
}
