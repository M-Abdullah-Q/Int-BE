import express from "express";
import http from "http";
import WebSocket from "ws";
import cors from "cors";
import dotenv from "dotenv";
import { prisma } from "./utils/prisma";
import { authenticateToken, generateToken } from "./middleware/auth";
import { wsManager } from "./utils/websocket";
import { AuthRequest } from "./types";
import axios from "axios";

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

const SIMULATION_MODE = true;
const AUTO_APPROVE_DELAY = 5000;

//db conn
prisma
  .$connect()
  .then(() => console.log("Connected to Neon"))
  .catch((error: any) => {
    console.error("Failed to connect to db", error);
    process.exit(1);
  });

app.post("/auth", async (req, res) => {
  try {
    const { studentId, name } = req.body;

    if (!studentId) {
      return res.status(400).json({ error: "Student ID required" });
    }

    let student = await prisma.student.findUnique({
      where: { studentId },
    });

    if (!student) {
      if (!name) {
        return res.status(400).json({ error: "Name required for new student" });
      }

      student = await prisma.student.create({
        data: {
          studentId,
          name,
        },
      });
    }

    const token = generateToken(studentId);
    res.json({ token, studentId, name: student.name });
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Health check
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
      simulationMode: SIMULATION_MODE,
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      timestamp: new Date().toISOString(),
      database: "disconnected",
    });
  }
});

// WS Thing

wss.on("connection", (ws: WebSocket, req) => {
  console.log("New WebSocket connection attempt");

  let studentId: string | null = null;

  ws.on("message", async (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      const { type, payload } = data;

      switch (type) {
        case "connect":
          const token = payload.token;
          studentId = wsManager.verifyToken(token);

          if (!studentId) {
            ws.send(
              JSON.stringify({ type: "error", message: "Invalid token" })
            );
            ws.close();
            return;
          }

          wsManager.addConnection(studentId, ws);
          ws.send(
            JSON.stringify({
              type: "connected",
              message: "Successfully connected",
              studentId,
              simulationMode: SIMULATION_MODE,
            })
          );
          break;

        case "daily_checkin":
          if (!studentId) {
            ws.send(
              JSON.stringify({ type: "error", message: "Not authenticated" })
            );
            return;
          }
          await handleDailyCheckin(studentId, payload, ws);
          break;

        case "remedial_completed":
          if (!studentId) {
            ws.send(
              JSON.stringify({ type: "error", message: "Not authenticated" })
            );
            return;
          }
          await handleRemedialCompletion(studentId, payload, ws);
          break;

        default:
          ws.send(
            JSON.stringify({ type: "error", message: "Unknown message type" })
          );
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid message format" })
      );
    }
  });

  ws.on("close", () => {
    if (studentId) {
      wsManager.removeConnection(studentId);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Lgs

async function handleDailyCheckin(
  studentId: string,
  payload: any,
  ws: WebSocket
) {
  try {
    const { quizScore, focusMinutes } = payload;

    if (quizScore === undefined || focusMinutes === undefined) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "quizScore and focusMinutes are required",
        })
      );
      return;
    }

    const isOnTrack = quizScore >= 7 && focusMinutes >= 60;
    const status = isOnTrack ? "On Track" : "Pending Mentor Review";

    if (isOnTrack) {
      const dailyLog = await prisma.dailyLog.create({
        data: {
          studentId,
          focusMinutes,
          quizScore,
          status,
        },
      });

      ws.send(
        JSON.stringify({
          type: "checkin_result",
          status: "On Track",
          message: "Great job! You are on track.",
          logId: dailyLog.logId,
        })
      );
    } else {
      const result = await prisma.$transaction(async (tx: any) => {
        const dailyLog = await tx.dailyLog.create({
          data: {
            studentId,
            focusMinutes,
            quizScore,
            status,
          },
        });

        const intervention = await tx.intervention.create({
          data: {
            studentId,
            taskAssigned: false,
            assignedTasks: null,
            completed: false,
          },
        });

        return { dailyLog, intervention };
      });

      ws.send(
        JSON.stringify({
          type: "checkin_result",
          status: "Pending Mentor Review",
          message:
            "Your performance needs attention. Waiting for mentor review.",
          interventionId: result.intervention.interventionId,
          logId: result.dailyLog.logId,
        })
      );

      // Sim n8n
      if (SIMULATION_MODE) {
        // SIMULATION: Auto-approve after delay
        console.log(
          `🔔 [SIMULATION] Auto-approving intervention ${result.intervention.interventionId} in ${AUTO_APPROVE_DELAY}ms`
        );
        simulateN8nApproval(
          studentId,
          result.intervention.interventionId,
          quizScore,
          focusMinutes
        );
      } else {
        // n8n (ltr)
        // triggerN8nWebhook(
        //   studentId,
        //   result.intervention.interventionId,
        //   quizScore,
        //   focusMinutes
        // );
      }
    }
  } catch (error) {
    console.error("Daily check-in error:", error);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Failed to process daily check-in",
      })
    );
  }
}

// Sim n8n approval
async function simulateN8nApproval(
  studentId: string,
  interventionId: number,
  quizScore: number,
  focusMinutes: number
) {
  // Simulate mentor review delay
  setTimeout(async () => {
    try {
      // Generate simulated remedial tasks based on performance
      let assignedTasks = "";

      if (quizScore < 7 && focusMinutes < 60) {
        assignedTasks = `1. Complete chapter revision exercises\n2. Practice focus techniques for 30 minutes\n3. Retake the quiz (Target: 7+/10)`;
      } else if (quizScore < 7) {
        assignedTasks = `1. Review incorrect quiz answers\n2. Complete practice problems\n3. Retake the quiz (Target: 7+/10)`;
      } else {
        assignedTasks = `1. Implement Pomodoro technique\n2. Track focus time daily\n3. Reach 60+ minutes tomorrow`;
      }

      // TODO: db update
      await prisma.intervention.update({
        where: { interventionId },
        data: {
          taskAssigned: true,
          assignedTasks,
          updatedAt: new Date(),
        },
      });

      console.log(
        `[SIMULATION] Intervention ${interventionId} approved for student ${studentId}`
      );

      // Send to student via WebSocket
      const sent = wsManager.sendToStudent(studentId, {
        type: "intervention_assigned",
        interventionId,
        assignedTasks,
        message:
          "🎓 Remedial task has been assigned by your mentor. Please complete it to unlock full access.",
        mode: "remedial_only",
        simulated: true,
      });

      if (!sent) {
        console.log(
          `[SIMULATION] Student ${studentId} is offline. Will receive task on reconnect.`
        );
      }
    } catch (error) {
      console.error("[SIMULATION] Error in simulated approval:", error);
    }
  }, AUTO_APPROVE_DELAY);
}

//n8n WEBHOOK (riyalllll)
/*
async function triggerN8nWebhook(
  studentId: string,
  interventionId: number,
  quizScore: number,
  focusMinutes: number
) {
  try {
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    if (!n8nUrl) {
      console.error('N8N_WEBHOOK_URL not configured');
      return;
    }

    await axios.post(n8nUrl, {
      studentId,
      interventionId,
      quizScore,
      focusMinutes,
      timestamp: new Date().toISOString()
    });

    console.log(`N8N webhook triggered for student ${studentId}`);
  } catch (error) {
    console.error('Failed to trigger n8n webhook:', error);
  }
}
*/

// Endpoint to receive approval from n8n (or manual testing)
app.post("/intervention/approve", express.json(), async (req, res) => {
  try {
    const { studentId, interventionId, assignedTasks, approved } = req.body;

    if (!studentId || !interventionId || !assignedTasks) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const updatedIntervention = await prisma.intervention.update({
      where: { interventionId },
      data: {
        taskAssigned: true,
        assignedTasks,
        updatedAt: new Date(),
      },
    });

    const sent = wsManager.sendToStudent(studentId, {
      type: "intervention_assigned",
      interventionId,
      assignedTasks,
      message:
        "Remedial task has been assigned. Please complete it to unlock full access.",
      mode: "remedial_only",
      manual: true,
    });

    if (sent) {
      res.json({
        success: true,
        message: "Intervention assigned and student notified",
        intervention: updatedIntervention,
      });
    } else {
      res.json({
        success: true,
        message: "Intervention assigned but student is offline",
        offline: true,
        intervention: updatedIntervention,
      });
    }
  } catch (error) {
    console.error("Intervention approval error:", error);
    res.status(500).json({ error: "Failed to process intervention approval" });
  }
});

async function handleRemedialCompletion(
  studentId: string,
  payload: any,
  ws: WebSocket
) {
  try {
    const { interventionId } = payload;

    if (!interventionId) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "interventionId is required",
        })
      );
      return;
    }

    const updatedIntervention = await prisma.intervention.updateMany({
      where: {
        interventionId,
        studentId,
        taskAssigned: true,
      },
      data: {
        completed: true,
        updatedAt: new Date(),
      },
    });

    if (updatedIntervention.count === 0) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid intervention or not assigned",
        })
      );
      return;
    }

    ws.send(
      JSON.stringify({
        type: "remedial_completed",
        message: "Remedial task completed successfully! Full access restored.",
        interventionId,
        mode: "normal",
      })
    );

    console.log(
      `Student ${studentId} completed intervention ${interventionId}`
    );
  } catch (error) {
    console.error("Remedial completion error:", error);
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Failed to mark remedial as completed",
      })
    );
  }
}

// extras

// Get student stats
app.get(
  "/students/:studentId/stats",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const { studentId } = req.params;

      const stats = await prisma.student.findUnique({
        where: { studentId },
        include: {
          dailyLogs: {
            orderBy: { timestamp: "desc" },
            take: 10,
          },
          interventions: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      });

      if (!stats) {
        return res.status(404).json({ error: "Student not found" });
      }

      const aggregates = await prisma.dailyLog.aggregate({
        where: { studentId },
        _avg: {
          quizScore: true,
          focusMinutes: true,
        },
        _count: true,
      });

      res.json({
        student: {
          studentId: stats.studentId,
          name: stats.name,
        },
        stats: {
          totalCheckins: aggregates._count,
          avgQuizScore: aggregates._avg.quizScore,
          avgFocusMinutes: aggregates._avg.focusMinutes,
        },
        // recentLogs: stats.recentLogs,
        recentInterventions: stats.interventions,
      });
    } catch (error) {
      console.error("Stats error:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  }
);

// Get pending interventions for student (to handle offline reconnections)
app.get(
  "/students/:studentId/pending-interventions",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const { studentId } = req.params;

      const pendingInterventions = await prisma.intervention.findMany({
        where: {
          studentId,
          taskAssigned: true,
          completed: false,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      res.json({
        studentId,
        pendingInterventions,
      });
    } catch (error) {
      console.error("Pending interventions error:", error);
      res.status(500).json({ error: "Failed to fetch pending interventions" });
    }
  }
);

// Manual approval endpoint for testing (bypass simulation)
app.post("/test/manual-approve", express.json(), async (req, res) => {
  try {
    const { interventionId, assignedTasks } = req.body;

    if (!interventionId) {
      return res.status(400).json({ error: "interventionId required" });
    }

    const intervention = await prisma.intervention.findUnique({
      where: { interventionId },
    });

    if (!intervention) {
      return res.status(404).json({ error: "Intervention not found" });
    }

    const tasks =
      assignedTasks || `Manual test task for intervention ${interventionId}`;

    const updated = await prisma.intervention.update({
      where: { interventionId },
      data: {
        taskAssigned: true,
        assignedTasks: tasks,
        updatedAt: new Date(),
      },
    });

    const sent = wsManager.sendToStudent(intervention.studentId, {
      type: "intervention_assigned",
      interventionId,
      assignedTasks: tasks,
      message: "Manual test: Remedial task assigned",
      mode: "remedial_only",
      manual: true,
    });

    res.json({
      success: true,
      message: "Manual approval processed",
      intervention: updated,
      studentNotified: sent,
    });
  } catch (error) {
    console.error("Manual approval error:", error);
    res.status(500).json({ error: "Failed to process manual approval" });
  }
});

// Server

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server ready`);
  console.log(`Prisma working`);
  if (SIMULATION_MODE) {
    console.log(
      `SIMULATION - Auto-approving interventions after ${AUTO_APPROVE_DELAY}ms`
    );
  }
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(async () => {
    console.log("HTTP server closed");
    await prisma.$disconnect();
    process.exit(0);
  });
});

process.on("SIGINT", async () => {
  console.log("SIGINT signal received: closing HTTP server");
  server.close(async () => {
    console.log("HTTP server closed");
    await prisma.$disconnect();
    process.exit(0);
  });
});
