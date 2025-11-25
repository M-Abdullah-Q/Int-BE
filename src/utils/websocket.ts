import WebSocket from "ws";
import { StudentConnection } from "../types";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret";

export class WebSocketManager {
  private connections: Map<string, WebSocket> = new Map();

  addConnection(studentId: string, socket: WebSocket) {
    this.connections.set(studentId, socket);
    console.log(`Student ${studentId} connected via WebSocket`);
  }

  removeConnection(studentId: string) {
    this.connections.delete(studentId);
    console.log(`Student ${studentId} disconnected`);
  }

  sendToStudent(studentId: string, message: any) {
    const socket = this.connections.get(studentId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  getConnection(studentId: string): WebSocket | undefined {
    return this.connections.get(studentId);
  }

  isConnected(studentId: string): boolean {
    const socket = this.connections.get(studentId);
    return socket !== undefined && socket.readyState === WebSocket.OPEN;
  }

  verifyToken(token: string): string | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { studentId: string };
      return decoded.studentId;
    } catch (error) {
      return null;
    }
  }
}

export const wsManager = new WebSocketManager();
