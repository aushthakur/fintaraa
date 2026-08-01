import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  authenticateToken,
  authorize,
} from "../../middlewares/authMiddleware";
import { CustomerController } from "./customer.controller";

const router = Router();

router.use(authenticateToken, authorize("admin"));
router.get("/", asyncHandler(CustomerController.list));
router.get("/export", asyncHandler(CustomerController.exportCsv));
router.get("/:id", asyncHandler(CustomerController.detail));
router.put("/:id", asyncHandler(CustomerController.update));
router.patch("/:id", asyncHandler(CustomerController.update));
router.patch("/:id/status", asyncHandler(CustomerController.updateStatus));
router.patch(
  "/:id/documents/verify",
  asyncHandler(CustomerController.verifyDocument),
);
router.post(
  "/:id/notifications",
  asyncHandler(CustomerController.sendNotification),
);
router.delete("/:id", asyncHandler(CustomerController.softDelete));

export default router;
