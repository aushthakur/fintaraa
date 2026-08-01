import { Router } from "express";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { AdminPartnerController } from "./partner.controller";

const router = Router();

router.use(authenticateToken, authorize("admin"));

// Static routes must stay above /:id.
router.get("/summary", asyncHandler(AdminPartnerController.summary));
router.get("/performance", asyncHandler(AdminPartnerController.performance));
router.get("/products", asyncHandler(AdminPartnerController.listProducts));
router.post("/products", asyncHandler(AdminPartnerController.createProduct));
router.put("/products/:id", asyncHandler(AdminPartnerController.updateProduct));
router.delete("/products/:id", asyncHandler(AdminPartnerController.deleteProduct));
router.post("/match", asyncHandler(AdminPartnerController.match));
router.get("/assignments", asyncHandler(AdminPartnerController.listAssignments));
router.post("/assignments", asyncHandler(AdminPartnerController.createAssignment));
router.patch(
  "/assignments/:id/status",
  asyncHandler(AdminPartnerController.updateAssignmentStatus),
);

router.get("/", asyncHandler(AdminPartnerController.list));
router.post("/", asyncHandler(AdminPartnerController.create));
router.get("/:id/credentials", asyncHandler(AdminPartnerController.getCredentials));
router.put("/:id/credentials", asyncHandler(AdminPartnerController.updateCredentials));
router.post(
  "/:id/credentials/test",
  asyncHandler(AdminPartnerController.testCredentials),
);
router.get("/:id", asyncHandler(AdminPartnerController.detail));
router.put("/:id", asyncHandler(AdminPartnerController.update));
router.delete("/:id", asyncHandler(AdminPartnerController.remove));

export default router;
