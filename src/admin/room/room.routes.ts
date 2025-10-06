import express from "express";
import { RoomController } from "./room.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
const { createRoom, getRoomById, getAllRooms, updateRoomById, deleteRoomById, getRoomsById, getAllPublicRooms } =
  RoomController;

const router = express.Router();

router
  .get(
    "/",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(getAllRooms)
  )
  .post("/", authenticateToken, authorize("property"), asyncHandler(createRoom))
  .get("/get-rooms/:id", authenticateToken, asyncHandler(getAllPublicRooms))
  .get("/public/:id", authenticateToken, asyncHandler(getRoomsById))
  .get(
    "/:id",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(getRoomById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("property", "admin"),
    asyncHandler(updateRoomById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("property"),
    asyncHandler(deleteRoomById)
  );

export default router;
