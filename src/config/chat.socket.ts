import { Types } from "mongoose";
import { Server, Socket } from "socket.io";
import { Message } from "../modals/message.model";
import { ChatService, SerializedMessage } from "../services/chat.service";

// ==================== TYPES & INTERFACES ====================
interface SocketData {
  socket: Socket;
  userId: string;
  socketId: string;
  connectedAt: Date;
  lastActivity: Date;
}

interface ChatMetrics {
  activeUsers: number;
  messagesSent: number;
  messagesRead: number;
  totalMessages: number;
  peakConnections: number;
  messagesDelivered: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxMessages: number;
}

// ==================== ADVANCED SOCKET MANAGER ====================
class AdvancedSocketManager {
  private sockets = new Map<string, Map<string, SocketData>>();
  private pendingQueue = new Map<string, SerializedMessage[]>();
  private typingUsers = new Map<string, Set<string>>();
  private messageRateLimit = new Map<string, number[]>();
  private metrics: ChatMetrics = {
    activeUsers: 0,
    messagesSent: 0,
    messagesRead: 0,
    totalMessages: 0,
    peakConnections: 0,
    messagesDelivered: 0,
  };

  private rateLimitConfig: RateLimitConfig = {
    maxMessages: 50,
    windowMs: 60000, // 1 minute
  };

  // Track user connection
  addUser(userId: string, socket: Socket): void {
    if (!this.sockets.has(userId)) {
      this.sockets.set(userId, new Map());
    }

    const userSockets = this.sockets.get(userId)!;
    userSockets.set(socket.id, {
      socket,
      userId,
      socketId: socket.id,
      connectedAt: new Date(),
      lastActivity: new Date(),
    });

    this.metrics.activeUsers = this.sockets.size;
    const totalConnections = this.getTotalConnections();
    if (totalConnections > this.metrics.peakConnections) {
      this.metrics.peakConnections = totalConnections;
    }

    console.log(
      `🔌 User ${userId} connected | Active users: ${this.sockets.size} | Connections: ${totalConnections}`
    );
  }

  // Remove user connection
  removeUser(userId: string, socketId: string): void {
    const userSockets = this.sockets.get(userId);
    if (!userSockets) {
      return;
    }

    const socketData = userSockets.get(socketId);
    if (socketData) {
      const sessionDuration = Date.now() - socketData.connectedAt.getTime();
      console.log(
        `⚡ User ${userId} disconnected (socket ${socketId}) | Session: ${(
          sessionDuration / 1000
        ).toFixed(0)}s`
      );
    }

    userSockets.delete(socketId);

    if (userSockets.size === 0) {
      this.sockets.delete(userId);
      this.typingUsers.delete(userId);
      this.messageRateLimit.delete(userId);
    }

    this.metrics.activeUsers = this.sockets.size;
  }

  // Get socket by user ID
  getSocket(userId: string): Socket | undefined {
    const sockets = this.sockets.get(userId);
    if (!sockets || sockets.size === 0) return undefined;
    const first = sockets.values().next();
    return first.done ? undefined : first.value.socket;
  }

  getSockets(userId: string): Socket[] {
    const sockets = this.sockets.get(userId);
    if (!sockets) return [];
    return Array.from(sockets.values()).map((data) => data.socket);
  }

  // Check if user is online
  isOnline(userId: string): boolean {
    const sockets = this.sockets.get(userId);
    return !!sockets && sockets.size > 0;
  }

  // Get all online users
  getOnlineUsers(): string[] {
    return Array.from(this.sockets.keys());
  }

  // Update last activity
  updateActivity(userId: string, socketId?: string): void {
    const userSockets = this.sockets.get(userId);
    if (!userSockets) return;

    if (socketId) {
      const socketData = userSockets.get(socketId);
      if (socketData) {
        socketData.lastActivity = new Date();
      }
      return;
    }

    userSockets.forEach((data) => {
      data.lastActivity = new Date();
    });
  }

  // Rate limiting check
  checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const userTimestamps = this.messageRateLimit.get(userId) || [];

    // Remove timestamps outside the window
    const validTimestamps = userTimestamps.filter(
      (ts) => now - ts < this.rateLimitConfig.windowMs
    );

    if (validTimestamps.length >= this.rateLimitConfig.maxMessages) {
      return false; // Rate limit exceeded
    }

    validTimestamps.push(now);
    this.messageRateLimit.set(userId, validTimestamps);
    return true;
  }

  // Queue management
  queueMessage(receiverId: string, msg: SerializedMessage): void {
    if (!this.pendingQueue.has(receiverId)) {
      this.pendingQueue.set(receiverId, []);
    }
    this.pendingQueue.get(receiverId)?.push(msg);
    console.log(
      `📬 Queued message for ${receiverId} | Queue size: ${
        this.pendingQueue.get(receiverId)?.length
      }`
    );
  }

  // Flush pending messages
  flushPendingMessages(userId: string, socket: Socket): void {
    const pending = this.pendingQueue.get(userId);
    if (pending && pending.length > 0) {
      console.log(`📨 Flushing ${pending.length} messages for ${userId}`);
      pending.forEach((msg, idx) => {
        setTimeout(() => {
          Message.findByIdAndUpdate(msg._id, {
            status: "delivered",
            updatedAt: new Date(),
          })
            .then(() => socketManager.incrementMessagesDelivered())
            .catch((error) =>
              ChatLogger.error(
                `Failed to set message ${msg._id} to delivered during flush`,
                error
              )
            );
          socket.emit("chat:incoming", { ...msg, status: "delivered" });
        }, idx * 10);
      });
      this.pendingQueue.delete(userId);
    }
  }

  // Typing indicators
  setTyping(userId: string, to: string): void {
    if (!this.typingUsers.has(to)) {
      this.typingUsers.set(to, new Set());
    }
    this.typingUsers.get(to)?.add(userId);
  }

  removeTyping(userId: string, to: string): void {
    this.typingUsers.get(to)?.delete(userId);
  }

  getTypingUsers(userId: string): string[] {
    return Array.from(this.typingUsers.get(userId) || []);
  }

  // Metrics
  incrementMessagesSent(): void {
    this.metrics.totalMessages++;
    this.metrics.messagesSent++;
  }

  incrementMessagesDelivered(): void {
    this.metrics.messagesDelivered++;
  }

  incrementMessagesRead(): void {
    this.metrics.messagesRead++;
  }

  getMetrics(): ChatMetrics {
    return { ...this.metrics };
  }

  // Broadcast to all users
  broadcast(event: string, data: any, excludeUserId?: string): void {
    this.sockets.forEach((socketMap, userId) => {
      if (userId !== excludeUserId) {
        socketMap.forEach((socketData) => {
          socketData.socket.emit(event, data);
        });
      }
    });
  }

  // Get connection info
  getConnectionInfo(userId: string): SocketData[] {
    const sockets = this.sockets.get(userId);
    return sockets ? Array.from(sockets.values()) : [];
  }

  emitToUser(
    userId: string,
    event: string,
    data: any,
    options?: { excludeSocketId?: string }
  ) {
    const sockets = this.sockets.get(userId);
    if (!sockets) return;
    sockets.forEach((socketData, socketId) => {
      if (options?.excludeSocketId && options.excludeSocketId === socketId) {
        return;
      }
      socketData.socket.emit(event, data);
    });
  }

  private getTotalConnections(): number {
    let total = 0;
    this.sockets.forEach((socketMap) => {
      total += socketMap.size;
    });
    return total;
  }
}

// ==================== VALIDATION & SANITIZATION ====================
class MessageValidator {
  private static readonly MAX_TEXT_LENGTH = 5000;
  private static readonly MIN_TEXT_LENGTH = 1;

  static validateMessage(text: string): { valid: boolean; error?: string } {
    if (!text || typeof text !== "string") {
      return { valid: false, error: "Message text is required" };
    }

    const trimmed = text.trim();

    if (trimmed.length < this.MIN_TEXT_LENGTH) {
      return { valid: false, error: "Message cannot be empty" };
    }

    if (trimmed.length > this.MAX_TEXT_LENGTH) {
      return {
        valid: false,
        error: `Message too long (max ${this.MAX_TEXT_LENGTH} characters)`,
      };
    }

    return { valid: true };
  }

  static sanitizeText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, " ") // Replace multiple spaces with single space
      .substring(0, this.MAX_TEXT_LENGTH);
  }

  static validateUserId(userId: string): any {
    return (
      typeof userId === "string" &&
      (userId.length === 24 || userId.length === 12) &&
      Types.ObjectId.isValid(userId)
    );
  }
}

// ==================== ERROR HANDLER ====================
class ChatErrorHandler {
  static handle(socket: Socket, error: any, context: string): void {
    console.log(`❌ Error in ${context}:`, error);

    const errorMessage = error?.message || "An error occurred";
    socket.emit("chat:error", {
      context,
      message: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  static validationError(socket: Socket, message: string): void {
    socket.emit("chat:error", {
      context: "validation",
      message,
      timestamp: new Date().toISOString(),
    });
  }

  static rateLimitError(socket: Socket): void {
    socket.emit("chat:error", {
      context: "rate_limit",
      message: "Too many messages. Please slow down.",
      timestamp: new Date().toISOString(),
    });
  }
}

// ==================== LOGGER ====================
class ChatLogger {
  private static log(level: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logData = data ? JSON.stringify(data) : "";
    console.log(`[${timestamp}] [${level}] ${message} ${logData}`);
  }

  static info(message: string, data?: any): void {
    this.log("INFO", message, data);
  }

  static error(message: string, data?: any): void {
    this.log("ERROR", message, data);
  }

  static warn(message: string, data?: any): void {
    this.log("WARN", message, data);
  }

  static debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === "development") {
      this.log("DEBUG", message, data);
    }
  }
}

// ==================== MAIN HANDLER ====================
const socketManager = new AdvancedSocketManager();

export function registerChatHandlers(io: Server, socket: Socket) {
  const userId = (socket as any).user._id.toString();

  // Add user to socket manager
  socketManager.addUser(userId, socket);
  socketManager.updateActivity(userId, socket.id);

  // Flush pending messages
  socketManager.flushPendingMessages(userId, socket);

  // Send welcome message with connection info
  socket.emit("chat:connected", {
    userId,
    connectedAt: new Date().toISOString(),
    onlineUsers: socketManager.getOnlineUsers().length,
    pendingMessages: 0,
  });

  void ChatService.getConversationSummaries(userId)
    .then((conversations) => {
      socket.emit("chat:conversations:result", {
        conversations,
        timestamp: new Date().toISOString(),
      });
    })
    .catch((error) => {
      ChatLogger.error("Failed to preload conversations", error);
    });

  socket.on("chat:conversations", async () => {
    try {
      socketManager.updateActivity(userId, socket.id);
      const conversations = await ChatService.getConversationSummaries(userId);
      socket.emit("chat:conversations:result", {
        conversations,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      ChatErrorHandler.handle(socket, e, "chat:conversations");
    }
  });

  // ==================== SEND MESSAGE ====================
  socket.on("chat:send", async (payload: any) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      const receiverId =
        payload?.receiverId || payload?.receiver_id || payload?.to;
      const incomingText = payload?.text ?? payload?.message ?? "";

      // Rate limiting
      if (!socketManager.checkRateLimit(userId)) {
        ChatErrorHandler.rateLimitError(socket);
        return;
      }

      // Validation
      if (!receiverId || !MessageValidator.validateUserId(receiverId)) {
        ChatErrorHandler.validationError(socket, "Invalid receiver ID");
        return;
      }

      const validation = MessageValidator.validateMessage(incomingText);
      if (!validation.valid) {
        ChatErrorHandler.validationError(socket, validation.error!);
        return;
      }

      if (userId === receiverId) {
        ChatErrorHandler.validationError(socket, "Cannot message yourself");
        return;
      }

      // Check receiver exists
      const receiver = await ChatService.ensureParticipantExists(receiverId);
      if (!receiver) {
        ChatErrorHandler.validationError(socket, "Receiver not found");
        return;
      }

      // Sanitize and create message
      const sanitizedText = MessageValidator.sanitizeText(incomingText);
      let message = await ChatService.createMessage(
        userId,
        receiverId,
        sanitizedText
      );
      socketManager.incrementMessagesSent();

      // Deliver or queue message
      if (socketManager.isOnline(receiverId)) {
        await Message.findByIdAndUpdate(message._id, {
          status: "delivered",
          updatedAt: new Date(),
        }).catch((error) =>
          ChatLogger.error(
            "Failed to update message status to delivered",
            error
          )
        );
        message = { ...message, status: "delivered" };
        socketManager.emitToUser(receiverId, "chat:incoming", message);
        socketManager.incrementMessagesDelivered();
        ChatLogger.info(`Message delivered: ${userId} → ${receiverId}`);
      } else {
        socketManager.queueMessage(receiverId, message);
        ChatLogger.info(`Message queued: ${userId} → ${receiverId}`);
      }

      // Confirm to sender
      socket.emit("chat:sent", message);

      // Stop typing indicator
      socketManager.removeTyping(userId, receiverId);
      socketManager.emitToUser(receiverId, "chat:stop-typing", {
        from: userId,
      });

      const [senderSummary, receiverSummary] = await Promise.all([
        ChatService.getConversationSummary(userId, receiverId),
        ChatService.getConversationSummary(receiverId, userId),
      ]);

      if (senderSummary) {
        socket.emit("chat:conversation:update", {
          conversation: senderSummary,
          timestamp: new Date().toISOString(),
        });
      }

      if (receiverSummary) {
        socketManager.emitToUser(receiverId, "chat:conversation:update", {
          conversation: receiverSummary,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      ChatErrorHandler.handle(socket, e, "chat:send");
    }
  });

  // ==================== GET CONVERSATION HISTORY ====================
  socket.on("chat:history", async ({ withUserId, limit = 50, before }) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      if (!withUserId || !MessageValidator.validateUserId(withUserId)) {
        ChatErrorHandler.validationError(socket, "Invalid user ID");
        return;
      }

      const numericLimit = Number(limit) || 50;
      const safeLimit = Math.min(Math.max(numericLimit, 1), 100);

      const messages = await ChatService.getMessagesBetween(
        userId,
        withUserId,
        safeLimit,
        before
      );

      socket.emit("chat:history:result", {
        messages,
        hasMore: messages.length === safeLimit,
        count: messages.length,
        withUserId,
        timestamp: new Date().toISOString(),
      });

      ChatLogger.debug(
        `History fetched: ${userId} ↔ ${withUserId} (${messages.length} messages)`
      );
    } catch (e) {
      ChatErrorHandler.handle(socket, e, "chat:history");
    }
  });

  // ==================== MARK AS READ ====================
  socket.on("chat:read", async (payload: any) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      const senderId =
        payload?.senderId || payload?.sender_id || payload?.fromUserId;

      if (!senderId || !MessageValidator.validateUserId(senderId)) {
        ChatErrorHandler.validationError(socket, "Invalid sender ID");
        return;
      }

      const modifiedCount = await ChatService.markConversationRead(
        userId,
        senderId
      );

      socketManager.incrementMessagesRead();

      // Notify sender
      socketManager.emitToUser(senderId, "chat:read:update", {
        readBy: userId,
        count: modifiedCount,
        timestamp: new Date().toISOString(),
      });

      socket.emit("chat:read:ack", {
        count: modifiedCount,
        timestamp: new Date().toISOString(),
      });

      ChatLogger.debug(
        `Messages marked read: ${senderId} → ${userId} (${modifiedCount})`
      );

      const [readerSummary, senderSummary] = await Promise.all([
        ChatService.getConversationSummary(userId, senderId),
        ChatService.getConversationSummary(senderId, userId),
      ]);

      if (readerSummary) {
        socket.emit("chat:conversation:update", {
          conversation: readerSummary,
          timestamp: new Date().toISOString(),
        });
      }

      if (senderSummary) {
        socketManager.emitToUser(senderId, "chat:conversation:update", {
          conversation: senderSummary,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      ChatErrorHandler.handle(socket, e, "chat:read");
    }
  });

  // ==================== TYPING INDICATORS ====================
  socket.on("chat:typing", ({ to }) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      if (!to || !MessageValidator.validateUserId(to)) {
        return;
      }

      socketManager.setTyping(userId, to);
      socketManager.emitToUser(to, "chat:typing", {
        from: userId,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      ChatLogger.error("Typing indicator error", e);
    }
  });

  socket.on("chat:stop-typing", ({ to }) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      if (!to || !MessageValidator.validateUserId(to)) {
        return;
      }

      socketManager.removeTyping(userId, to);
      socketManager.emitToUser(to, "chat:stop-typing", {
        from: userId,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      ChatLogger.error("Stop typing error", e);
    }
  });

  // ==================== ONLINE STATUS ====================
  socket.on("chat:online-status", ({ userIds }) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      if (!Array.isArray(userIds)) {
        ChatErrorHandler.validationError(socket, "User IDs must be an array");
        return;
      }

      const status: Record<string, boolean> = {};
      userIds.forEach((id: string) => {
        if (MessageValidator.validateUserId(id)) {
          status[id] = socketManager.isOnline(id);
        }
      });

      socket.emit("chat:online-status:result", {
        status,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      ChatErrorHandler.handle(socket, e, "chat:online-status");
    }
  });

  // ==================== GET METRICS (Admin/Debug) ====================
  socket.on("chat:metrics", () => {
    try {
      // Only allow if user has admin role
      const user = (socket as any).user;
      if (user?.role === "admin") {
        socket.emit("chat:metrics:result", {
          ...socketManager.getMetrics(),
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      ChatLogger.error("Metrics error", e);
    }
  });

  // ==================== GET UNREAD COUNT ====================
  socket.on("chat:unread-count", async ({ fromUserId }) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      const query: any = {
        receiver: userId,
        status: { $ne: "read" },
      };

      if (fromUserId && MessageValidator.validateUserId(fromUserId)) {
        query.sender = fromUserId;
      }

      const count = await Message.countDocuments(query);

      socket.emit("chat:unread-count:result", {
        count,
        fromUserId: fromUserId || "all",
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      ChatErrorHandler.handle(socket, e, "chat:unread-count");
    }
  });

  // ==================== DELETE MESSAGE ====================
  socket.on("chat:delete", async ({ messageId }) => {
    try {
      socketManager.updateActivity(userId, socket.id);

      if (!messageId || !MessageValidator.validateUserId(messageId)) {
        ChatErrorHandler.validationError(socket, "Invalid message ID");
        return;
      }

      const message = await Message.findOne({
        _id: messageId,
        sender: userId,
      });

      if (!message) {
        ChatErrorHandler.validationError(
          socket,
          "Message not found or unauthorized"
        );
        return;
      }

      await message.save();
      socket.emit("chat:delete:ack", {
        messageId,
        timestamp: new Date().toISOString(),
      });

      // Notify receiver
      const receiverSocket = socketManager.getSocket(
        message.receiver.toString()
      );
      receiverSocket?.emit("chat:message-deleted", {
        messageId,
        timestamp: new Date().toISOString(),
      });

      ChatLogger.info(`Message deleted: ${messageId} by ${userId}`);
    } catch (e) {
      ChatErrorHandler.handle(socket, e, "chat:delete");
    }
  });

  // ==================== DISCONNECT ====================
  socket.on("disconnect", () => {
    socketManager.removeUser(userId, socket.id);

    // Broadcast offline status to relevant users (optional)
    // You could implement presence system here
  });

  // ==================== ERROR HANDLING ====================
  socket.on("error", (error) => {
    ChatLogger.error(`Socket error for user ${userId}`, error);
  });
}

// ==================== EXPORTS ====================
export { socketManager, ChatLogger, MessageValidator };
export default registerChatHandlers;
