import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { ContactSyncController } from "./contactSync.controller";

const router = express.Router();

router.use(authenticateToken);

router.get(
  "/",
  authorize("admin"),
  asyncHandler(ContactSyncController.getAllContactSyncs)
);
router.get(
  "/:id",
  authorize("admin"),
  asyncHandler(ContactSyncController.getContactSyncById)
);
router.delete(
  "/:id",
  authorize("admin"),
  asyncHandler(ContactSyncController.deleteContactSyncById)
);

export default router;
