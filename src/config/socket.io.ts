import dotenv from "dotenv";
import { config } from "./config";
import { Server } from "socket.io";
import { Application } from "express";
import { Server as HttpServer } from "http";

dotenv.config();

interface User {
  userId: string;
  socketId: string;
}

let users: User[] = [];

const addUser = (userId: string, socketId: string): void => {
  if (!users.some((user) => user.userId === userId)) {
    users.push({ userId, socketId });
  }
};

const removeUser = (socketId: string): void => {
  users = users.filter((user) => user.socketId !== socketId);
};

const getUser = (userId: string): User | undefined => {
  return users.find((user) => user.userId === userId);
};

export const configureSocket = async (
  httpServer: HttpServer,
  app: Application,
): Promise<void> => {
  const io = new Server(httpServer, {
    cors: {
      origin: config.frontendUrl,
      methods: ["GET", "POST"],
    },
  });

  app.set("socketio", io);

  io.on("connection", (socket: any) => {
    console.log("A user connected:", socket._id);

    socket.on("addUser", (userId: string) => {
      if (userId) {
        addUser(userId, socket._id);
        io.emit("getUsers", users);
      } else {
        console.log("Invalid userId on addUser event");
      }
    });

    socket.on(
      "sendMessage",
      ({
        senderId,
        receiverId,
        text,
        chatFile,
      }: {
        senderId: string;
        receiverId: string;
        text?: string;
        chatFile?: string;
      }) => {
        const user = getUser(receiverId);
        if (user) {
          io.to(user.socketId).emit("getMessage", {
            senderId,
            chatFile: chatFile || null,
            text: text || "",
          });
        } else {
          console.log(`User ${receiverId} not connected, message not sent`);
        }
      },
    );

    socket.on(
      "markAsRead",
      ({ senderId, receiverId }: { senderId: string; receiverId: string }) => {
        const user = getUser(senderId);
        if (user) {
          io.to(user.socketId).emit("messagesRead", { receiverId });
        } else {
          console.log(
            `User ${senderId} not connected, cannot mark messages as read`,
          );
        }
      },
    );

    socket.on("typing", (receiverId: string, senderId: string) => {
      const user = getUser(receiverId);
      if (user) {
        io.to(user.socketId).emit("user-typing", senderId);
      } else {
        console.log(
          `User ${receiverId} not connected, typing status not sent`,
        );
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket._id);
      removeUser(socket._id);
      io.emit("getUsers", users);
    });
  });

  io.on("error", (error: Error) => {
    console.log("Socket.IO error:", error);
  });
};
