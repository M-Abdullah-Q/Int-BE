import { Request } from "express";
import { JwtPayload } from "jsonwebtoken";
import WebSocket from "ws";

export interface AuthRequest extends Request {
  user?: string | JwtPayload;
}

export interface StudentConnection {
  studentId: string;
  socket: WebSocket;
}

export interface DailyCheckInData {
  studentId: string;
  quizScore: number;
  focusMinutes: number;
}

export interface InterventionApprovalData {
  studentId: string;
  interventionId: number;
  assignedTasks: string;
  approved: boolean;
}

export interface RemedialCompletionData {
  studentId: string;
  interventionId: number;
}
