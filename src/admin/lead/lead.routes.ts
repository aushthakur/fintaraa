import express, { Request, Response, NextFunction } from "express";
import { LeadController } from "./lead.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { config } from "../../config/config";
import ApiError from "../../utils/ApiError";

const router = express.Router();

const verifyIntegrationKey = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const secret = config.integrations.inboundWebhookKey;
  if (!secret) return next();
  const provided =
    req.header("x-integration-key") ||
    req.query.integrationKey?.toString() ||
    (req.body?.integrationKey as string | undefined);

  if (provided !== secret) {
    return next(new ApiError(403, "Invalid integration token"));
  }
  return next();
};

router.post(
  "/connectors/:source",
  verifyIntegrationKey,
  asyncHandler(LeadController.ingestFromConnector)
);

router.use(authenticateToken, authorize("admin"));

router
  .route("/")
  .get(asyncHandler(LeadController.getLeads))
  .post(asyncHandler(LeadController.createLead));

router.get("/pipeline/summary", asyncHandler(LeadController.pipelineSummary));

router.get("/:id", asyncHandler(LeadController.getLead));
router.post("/:id/notes", asyncHandler(LeadController.addNote));
router.post("/:id/follow-ups", asyncHandler(LeadController.addFollowUp));
router.post(
  "/:id/follow-ups/status",
  asyncHandler(LeadController.updateFollowUpStatus)
);
router.post("/:id/status", asyncHandler(LeadController.updateStatus));
router.post("/:id/reassign", asyncHandler(LeadController.reassign));
router.post("/:id/escalate", asyncHandler(LeadController.escalate));
router.post("/:id/convert", asyncHandler(LeadController.convert));

export default router;
