import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { ContactRequestController } from "./contactRequest.controller";

const router = express.Router();

router.post(
  "/",
  asyncHandler(ContactRequestController.createContactRequest),
);

router.get(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(ContactRequestController.getAllContactRequests),
);

router.get(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(ContactRequestController.getContactRequestById),
);

router.put(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(ContactRequestController.updateContactRequestById),
);

router.delete(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(ContactRequestController.deleteContactRequestById),
);

export default router;
