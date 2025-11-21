import express from "express";
import { PrivacyController } from "./privacy.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router
  .get("/", authenticateToken, asyncHandler(PrivacyController.getAll))
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(PrivacyController.create)
  )
  .get("/:id", authenticateToken, asyncHandler(PrivacyController.getById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(PrivacyController.update)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(PrivacyController.remove)
  );

export default router;
