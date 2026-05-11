import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  authenticateToken,
  authorize,
} from "../../middlewares/authMiddleware";
import { EligibilityMailPermissionController } from "./eligibilityMailPermission.controller";

const router = express.Router();

router.get(
  "/options",
  authenticateToken,
  authorize("admin", "agent"),
  asyncHandler(EligibilityMailPermissionController.getOptions),
);

router.get(
  "/me",
  authenticateToken,
  authorize("admin", "agent"),
  asyncHandler(EligibilityMailPermissionController.getMine),
);

router
  .route("/")
  .post(
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityMailPermissionController.create),
  )
  .get(
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityMailPermissionController.getAll),
  );

router
  .route("/:id")
  .get(
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityMailPermissionController.getById),
  )
  .put(
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityMailPermissionController.updateById),
  )
  .delete(
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityMailPermissionController.deleteById),
  );

export default router;
