// Slot Routes
import express from "express";
import {
  createSlot,
  getAllSlots,
  getSlotById,
  updateSlotById,
  deleteSlotById,
} from "./slot.controller";

const router = express.Router();

router
  .post("/", createSlot)
  .get("/", getAllSlots)
  .get("/:id", getSlotById)
  .put("/:id", updateSlotById)
  .delete("/:id", deleteSlotById);

export default router;
