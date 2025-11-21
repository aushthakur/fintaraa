import dotenv from "dotenv";
import { config } from "./config";
import { Application } from "express";
import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";

dotenv.config();

// ==================== INTERFACES & TYPES ====================
interface User {
  userId: string;
  socketId: string;
  connectedAt: Date;
  lastActivity: Date;
  metadata?: {
    ip?: string;
    userAgent?: string;
    platform?: string;
  };
}

interface MessageData {
  text?: string;
  timestamp?: Date;
  senderId: string;
  ticketId?: string;
  chatFile?: string;
  receiverId: string;
  messageId?: string;
}

interface TypingData {
  senderId: string;
  isTyping: boolean;
  receiverId: string;
}

interface ReadReceiptData {
  senderId: string;
  receiverId: string;
  messageIds?: string[];
}

interface SocketMetrics {
  totalConnections: number;
  activeUsers: number;
  peakConnections: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesRead: number;
  averageLatency: number;
  uptime: number;
}

// ==================== ADVANCED USER MANAGER ====================
class AdvancedUserManager {
  private users: Map<string, User> = new Map();
  private socketToUser: Map<string, string> = new Map();
  private typingUsers: Map<string, Set<string>> = new Map();
  private messageQueue: Map<string, MessageData[]> = new Map();
  private rateLimits: Map<string, number[]> = new Map();

  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly MAX_MESSAGES_PER_WINDOW = 100;
  private readonly MESSAGE_QUEUE_LIMIT = 50;

  // Add user with enhanced metadata
  addUser(userId: string, socketId: string, metadata?: User["metadata"]): void {
    if (!userId || !socketId) {
      console.warn("⚠️ Invalid userId or socketId in addUser");
      return;
    }

    const existingUser = this.users.get(userId);
    if (existingUser) {
      console.log(
        `🔄 User ${userId} reconnecting (old: ${existingUser.socketId}, new: ${socketId})`
      );
      this.socketToUser.delete(existingUser.socketId);
    }

    const user: User = {
      userId,
      socketId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      metadata,
    };

    this.users.set(userId, user);
    this.socketToUser.set(socketId, userId);

    console.log(
      `✅ User added: ${userId} | Socket: ${socketId} | Active: ${this.users.size}`
    );
  }

  // Remove user
  removeUser(socketId: string): any {
    const userId = this.socketToUser.get(socketId);
    if (!userId) {
      console.warn(`⚠️ No user found for socket: ${socketId}`);
      return null;
    }

    const user = this.users.get(userId);
    if (user) {
      const sessionDuration = Date.now() - user.connectedAt.getTime();
      console.log(
        `👋 User disconnected: ${userId} | Session: ${(
          sessionDuration / 1000
        ).toFixed(0)}s`
      );
    }

    this.users.delete(userId);
    this.socketToUser.delete(socketId);
    this.typingUsers.delete(userId);
    this.rateLimits.delete(userId);

    console.log(`📊 Active users: ${this.users.size}`);
    return user;
  }

  // Get user by userId
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  // Get user by socketId
  getUserBySocket(socketId: string): User | undefined {
    const userId = this.socketToUser.get(socketId);
    return userId ? this.users.get(userId) : undefined;
  }

  // Get all users
  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  // Check if user is online
  isOnline(userId: string): boolean {
    return this.users.has(userId);
  }

  // Update last activity
  updateActivity(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.lastActivity = new Date();
    }
  }

  // Rate limiting
  checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userTimestamps = this.rateLimits.get(userId) || [];

    const validTimestamps = userTimestamps.filter(
      (ts) => now - ts < this.RATE_LIMIT_WINDOW
    );

    if (validTimestamps.length >= this.MAX_MESSAGES_PER_WINDOW) {
      console.warn(`⚠️ Rate limit exceeded for user: ${userId}`);
      return false;
    }

    validTimestamps.push(now);
    this.rateLimits.set(userId, validTimestamps);
    return true;
  }

  // Typing indicators
  setTyping(senderId: string, receiverId: string): void {
    if (!this.typingUsers.has(receiverId)) {
      this.typingUsers.set(receiverId, new Set());
    }
    this.typingUsers.get(receiverId)?.add(senderId);
  }

  removeTyping(senderId: string, receiverId: string): void {
    this.typingUsers.get(receiverId)?.delete(senderId);
    if (this.typingUsers.get(receiverId)?.size === 0) {
      this.typingUsers.delete(receiverId);
    }
  }

  getTypingUsers(userId: string): string[] {
    return Array.from(this.typingUsers.get(userId) || []);
  }

  // Message queue for offline users
  queueMessage(userId: string, message: MessageData): void {
    if (!this.messageQueue.has(userId)) {
      this.messageQueue.set(userId, []);
    }

    const queue = this.messageQueue.get(userId)!;
    if (queue.length >= this.MESSAGE_QUEUE_LIMIT) {
      queue.shift(); // Remove oldest message
    }

    queue.push(message);
    console.log(
      `📬 Message queued for offline user: ${userId} | Queue: ${queue.length}`
    );
  }

  flushQueue(userId: string): MessageData[] {
    const messages = this.messageQueue.get(userId) || [];
    this.messageQueue.delete(userId);
    if (messages.length > 0) {
      console.log(
        `📨 Flushing ${messages.length} queued messages for: ${userId}`
      );
    }
    return messages;
  }

  // Get statistics
  getStats(): {
    totalUsers: number;
    onlineUsers: string[];
    queuedMessages: number;
    typingUsers: number;
  } {
    return {
      totalUsers: this.users.size,
      onlineUsers: Array.from(this.users.keys()),
      queuedMessages: Array.from(this.messageQueue.values()).reduce(
        (sum, queue) => sum + queue.length,
        0
      ),
      typingUsers: this.typingUsers.size,
    };
  }
}

// ==================== SOCKET LOGGER ====================
class SocketLogger {
  private static startTime = Date.now();

  static log(
    level: "INFO" | "WARN" | "ERROR" | "DEBUG",
    message: string,
    data?: any
  ): void {
    const timestamp = new Date().toISOString();
    const emoji = {
      INFO: "ℹ️",
      WARN: "⚠️",
      ERROR: "❌",
      DEBUG: "🔍",
    };

    const logMessage = `[${timestamp}] ${emoji[level]} ${message}`;

    if (data) {
      console.log(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(logMessage);
    }
  }

  static info(message: string, data?: any): void {
    this.log("INFO", message, data);
  }

  static warn(message: string, data?: any): void {
    this.log("WARN", message, data);
  }

  static error(message: string, data?: any): void {
    this.log("ERROR", message, data);
  }

  static debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === "development") {
      this.log("DEBUG", message, data);
    }
  }

  static getUptime(): number {
    return Date.now() - this.startTime;
  }
}

// ==================== METRICS TRACKER ====================
class MetricsTracker {
  private metrics: SocketMetrics = {
    uptime: 0,
    activeUsers: 0,
    messagesSent: 0,
    messagesRead: 0,
    averageLatency: 0,
    peakConnections: 0,
    totalConnections: 0,
    messagesDelivered: 0,
  };

  private latencies: number[] = [];

  incrementConnections(): void {
    this.metrics.totalConnections++;
  }

  updateActiveUsers(count: number): void {
    this.metrics.activeUsers = count;
    if (count > this.metrics.peakConnections) {
      this.metrics.peakConnections = count;
    }
  }

  incrementMessagesSent(): void {
    this.metrics.messagesSent++;
  }

  incrementMessagesDelivered(): void {
    this.metrics.messagesDelivered++;
  }

  incrementMessagesRead(): void {
    this.metrics.messagesRead++;
  }

  recordLatency(latency: number): void {
    this.latencies.push(latency);
    if (this.latencies.length > 100) {
      this.latencies.shift();
    }
    this.metrics.averageLatency =
      this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  getMetrics(): SocketMetrics {
    return {
      ...this.metrics,
      uptime: SocketLogger.getUptime(),
    };
  }

  logMetrics(): void {
    SocketLogger.info("Socket Metrics", this.getMetrics());
  }
}

// ==================== VALIDATION ====================
class SocketValidator {
  static validateUserId(userId: string): boolean {
    return (
      typeof userId === "string" && userId.length > 0 && userId.length <= 100
    );
  }

  static validateMessage(data: MessageData): {
    valid: boolean;
    error?: string;
  } {
    if (!data.senderId || !this.validateUserId(data.senderId)) {
      return { valid: false, error: "Invalid senderId" };
    }

    if (!data.receiverId || !this.validateUserId(data.receiverId)) {
      return { valid: false, error: "Invalid receiverId" };
    }

    if (!data.text && !data.chatFile) {
      return { valid: false, error: "Message must have text or file" };
    }

    if (data.text && data.text.length > 5000) {
      return { valid: false, error: "Text too long (max 5000 characters)" };
    }

    return { valid: true };
  }

  static sanitizeText(text: string): string {
    return text.trim().replace(/\s+/g, " ").substring(0, 5000);
  }
}

// ==================== MAIN CONFIGURATION ====================
const userManager = new AdvancedUserManager();
const metricsTracker = new MetricsTracker();
let rootIo: Server | null = null;

const createMessageId = () =>
  `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const enrichMessagePayload = (data: MessageData): MessageData => ({
  ...data,
  timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
  messageId: data.messageId ?? createMessageId(),
});

const deliverMessageToReceiver = (
  ioInstance: Server | null,
  message: MessageData,
  notifyTyping: boolean = false
): "delivered" | "queued" => {
  const receiver = userManager.getUser(message.receiverId);

  if (receiver && ioInstance) {
    ioInstance.to(receiver.socketId).emit("getMessage", message);
    metricsTracker.incrementMessagesDelivered();

    if (notifyTyping) {
      userManager.removeTyping(message.senderId, message.receiverId);
      ioInstance
        .to(receiver.socketId)
        .emit("userStoppedTyping", message.senderId);
    }

    return "delivered";
  }

  userManager.queueMessage(message.receiverId, message);
  return "queued";
};

export const emitSupportMessage = (payload: MessageData) => {
  if (!rootIo) {
    SocketLogger.warn("Socket server not initialized for emitSupportMessage");
    return false;
  }

  const validation = SocketValidator.validateMessage(payload);
  if (!validation.valid) {
    SocketLogger.warn("emitSupportMessage validation failed", {
      error: validation.error,
      payload,
    });
    return false;
  }

  const sanitizedText = payload.text
    ? SocketValidator.sanitizeText(payload.text)
    : undefined;

  const enrichedMessage = enrichMessagePayload({
    ...payload,
    text: sanitizedText,
  });

  metricsTracker.incrementMessagesSent();
  userManager.updateActivity(payload.senderId);

  const status = deliverMessageToReceiver(rootIo, enrichedMessage, true);

  SocketLogger.info("Support message emitted", {
    from: payload.senderId,
    to: payload.receiverId,
    ticketId: payload.ticketId,
    status,
  });

  return true;
};

export const configureSocket = async (
  httpServer: HttpServer,
  app: Application
): Promise<void> => {
  const io = new Server(httpServer, {
    cors: {
      origin: config.frontendUrl,
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ["websocket", "polling"],
    allowEIO3: true,
  });
  rootIo = io;

  app.set("socketio", io);

  // Middleware for authentication (optional)
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    // Add your authentication logic here
    // if (!token) return next(new Error("Authentication error"));
    next();
  });

  // Connection handler
  io.on("connection", (socket: Socket) => {
    metricsTracker.incrementConnections();

    SocketLogger.info(`New connection`, {
      socketId: socket.id,
      transport: socket.conn.transport.name,
      ip: socket.handshake.address,
    });

    // ==================== ADD USER ====================
    socket.on("addUser", (userId: string) => {
      if (!SocketValidator.validateUserId(userId)) {
        SocketLogger.warn("Invalid userId on addUser event", { userId });
        socket.emit("error", { message: "Invalid user ID" });
        return;
      }

      const metadata: any = {
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers["user-agent"],
        platform: socket.handshake.headers["sec-ch-ua-platform"],
      };

      userManager.addUser(userId, socket.id, metadata);
      metricsTracker.updateActiveUsers(userManager.getAllUsers().length);

      // Send current users list
      io.emit("getUsers", userManager.getAllUsers());

      // Send queued messages
      const queuedMessages = userManager.flushQueue(userId);
      if (queuedMessages.length > 0) {
        queuedMessages.forEach((msg, idx) => {
          setTimeout(() => {
            socket.emit("getMessage", msg);
            metricsTracker.incrementMessagesDelivered();
          }, idx * 100);
        });
      }

      // Send welcome message
      socket.emit("userAdded", {
        userId,
        onlineUsers: userManager.getAllUsers().length,
        queuedMessages: queuedMessages.length,
        timestamp: new Date().toISOString(),
      });

      SocketLogger.info(`User added successfully`, {
        userId,
        socketId: socket.id,
      });
    });

    // ==================== SEND MESSAGE ====================
    socket.on("sendMessage", (data: MessageData) => {
      const startTime = Date.now();
      const currentUser = userManager.getUserBySocket(socket.id);

      if (!currentUser) {
        SocketLogger.warn("Message from unregistered socket", {
          socketId: socket.id,
        });
        socket.emit("error", {
          message: "User not registered. Please call addUser first.",
        });
        return;
      }

      // Rate limiting
      if (!userManager.checkRateLimit(currentUser.userId)) {
        socket.emit("error", {
          message: "Rate limit exceeded. Please slow down.",
        });
        return;
      }

      // Validation
      const validation = SocketValidator.validateMessage(data);
      if (!validation.valid) {
        SocketLogger.warn("Invalid message data", {
          error: validation.error,
          data,
        });
        socket.emit("error", { message: validation.error });
        return;
      }

      // Sanitize & enrich message
      const sanitizedText = data.text
        ? SocketValidator.sanitizeText(data.text)
        : undefined;
      const enrichedMessage = enrichMessagePayload({
        ...data,
        text: sanitizedText,
      });

      metricsTracker.incrementMessagesSent();
      userManager.updateActivity(currentUser.userId);

      const deliveryStatus = deliverMessageToReceiver(
        io,
        enrichedMessage,
        true
      );

      if (deliveryStatus === "delivered") {
        const latency = Date.now() - startTime;
        metricsTracker.recordLatency(latency);

        SocketLogger.debug(`Message delivered`, {
          from: data.senderId,
          to: data.receiverId,
          latency: `${latency}ms`,
        });

        socket.emit("messageDelivered", {
          messageId: enrichedMessage.messageId,
          timestamp: new Date().toISOString(),
          status: "delivered",
        });
      } else {
        SocketLogger.info(`User offline, message queued`, {
          from: data.senderId,
          to: data.receiverId,
        });

        socket.emit("messageQueued", {
          messageId: enrichedMessage.messageId,
          timestamp: new Date().toISOString(),
          status: "queued",
        });
      }
    });

    // ==================== MARK AS READ ====================
    socket.on("markAsRead", (data: ReadReceiptData) => {
      const currentUser = userManager.getUserBySocket(socket.id);

      if (!currentUser) {
        socket.emit("error", { message: "User not registered" });
        return;
      }

      if (!SocketValidator.validateUserId(data.senderId)) {
        SocketLogger.warn("Invalid senderId in markAsRead", data);
        return;
      }

      userManager.updateActivity(currentUser.userId);
      metricsTracker.incrementMessagesRead();

      const sender = userManager.getUser(data.senderId);
      if (sender) {
        io.to(sender.socketId).emit("messagesRead", {
          receiverId: data.receiverId,
          messageIds: data.messageIds,
          timestamp: new Date().toISOString(),
        });

        SocketLogger.debug(`Messages marked as read`, {
          from: data.senderId,
          by: data.receiverId,
        });
      } else {
        SocketLogger.info(`Sender offline, read receipt not delivered`, {
          senderId: data.senderId,
        });
      }

      // Acknowledge to reader
      socket.emit("readAck", {
        senderId: data.senderId,
        timestamp: new Date().toISOString(),
      });
    });

    // ==================== TYPING INDICATOR ====================
    socket.on("typing", (receiverId: string, senderId?: string) => {
      const currentUser = userManager.getUserBySocket(socket.id);

      if (!currentUser) {
        return;
      }

      const actualSenderId = senderId || currentUser.userId;

      if (
        !SocketValidator.validateUserId(receiverId) ||
        !SocketValidator.validateUserId(actualSenderId)
      ) {
        return;
      }

      userManager.updateActivity(currentUser.userId);
      userManager.setTyping(actualSenderId, receiverId);

      const receiver = userManager.getUser(receiverId);
      if (receiver) {
        io.to(receiver.socketId).emit("userTyping", {
          senderId: actualSenderId,
          timestamp: new Date().toISOString(),
        });

        SocketLogger.debug(`Typing indicator sent`, {
          from: actualSenderId,
          to: receiverId,
        });
      }
    });

    // ==================== STOP TYPING ====================
    socket.on("stopTyping", (receiverId: string, senderId?: string) => {
      const currentUser = userManager.getUserBySocket(socket.id);

      if (!currentUser) {
        return;
      }

      const actualSenderId = senderId || currentUser.userId;

      if (
        !SocketValidator.validateUserId(receiverId) ||
        !SocketValidator.validateUserId(actualSenderId)
      ) {
        return;
      }

      userManager.updateActivity(currentUser.userId);
      userManager.removeTyping(actualSenderId, receiverId);

      const receiver = userManager.getUser(receiverId);
      if (receiver) {
        io.to(receiver.socketId).emit("userStoppedTyping", {
          senderId: actualSenderId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // ==================== GET ONLINE STATUS ====================
    socket.on("checkOnlineStatus", (userIds: string[]) => {
      if (!Array.isArray(userIds)) {
        socket.emit("error", { message: "User IDs must be an array" });
        return;
      }

      const status: Record<string, boolean> = {};
      userIds.forEach((id) => {
        if (SocketValidator.validateUserId(id)) {
          status[id] = userManager.isOnline(id);
        }
      });

      socket.emit("onlineStatusResult", {
        status,
        timestamp: new Date().toISOString(),
      });
    });

    // ==================== GET TYPING USERS ====================
    socket.on("getTypingUsers", (userId: string) => {
      const typingUsers = userManager.getTypingUsers(userId);
      socket.emit("typingUsersResult", {
        users: typingUsers,
        timestamp: new Date().toISOString(),
      });
    });

    // ==================== GET METRICS (Admin) ====================
    socket.on("getMetrics", () => {
      const currentUser = userManager.getUserBySocket(socket.id);
      // Add admin check here if needed
      // if (currentUser?.role !== 'admin') return;

      socket.emit("metricsResult", {
        ...metricsTracker.getMetrics(),
        ...userManager.getStats(),
        timestamp: new Date().toISOString(),
      });
    });

    // ==================== DISCONNECT ====================
    socket.on("disconnect", (reason) => {
      const user = userManager.removeUser(socket.id);
      metricsTracker.updateActiveUsers(userManager.getAllUsers().length);

      if (user) {
        io.emit("getUsers", userManager.getAllUsers());

        SocketLogger.info(`User disconnected`, {
          userId: user.userId,
          reason,
          sessionDuration: `${(
            (Date.now() - user.connectedAt.getTime()) /
            1000
          ).toFixed(0)}s`,
        });
      }
    });

    // ==================== ERROR HANDLING ====================
    socket.on("error", (error) => {
      SocketLogger.error("Socket error", {
        socketId: socket.id,
        error: error.message,
      });
    });
  });

  // ==================== SERVER ERROR HANDLING ====================
  io.on("error", (error: Error) => {
    SocketLogger.error("Socket.IO server error", {
      error: error.message,
      stack: error.stack,
    });
  });

  // ==================== PERIODIC METRICS LOGGING ====================
  setInterval(() => {
    metricsTracker.logMetrics();
  }, 300000); // Every 5 minutes

  SocketLogger.info("Socket.IO server configured successfully", {
    cors: config.frontendUrl,
    transports: ["websocket", "polling"],
  });
};

// ==================== EXPORTS ====================
export { userManager, metricsTracker, SocketLogger };
export default configureSocket;
