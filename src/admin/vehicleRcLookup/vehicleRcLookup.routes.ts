import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { VehicleRcLookupController } from "./vehicleRcLookup.controller";

const router = express.Router();

router.use(authenticateToken);

router.get(
  "/",
  authorize("admin"),
  asyncHandler(VehicleRcLookupController.getAllRcLookups)
);
router.get(
  "/:id",
  authorize("admin"),
  asyncHandler(VehicleRcLookupController.getRcLookupById)
);
router.delete(
  "/:id",
  authorize("admin"),
  asyncHandler(VehicleRcLookupController.deleteRcLookupById)
);

export default router;
