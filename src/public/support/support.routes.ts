/**
 * @file ticket.routes.ts
 * @description Defines all API endpoints related to ticket and agent management.
 * - Routes are protected using JWT authentication via `authenticateToken` middleware.
 * - Supports CRUD operations for support agents and support tickets.
 * - Handles ticket assignment, ticket interactions, and status updates.
 *
 * @routes
 * POST   /tickets                       → Create a new ticket
 * GET    /tickets                       → Retrieve all tickets (with optional filters)
 * GET    /tickets/:id                  → Retrieve a single ticket by ID
 * GET    /tickets/:id/:status          → Update a ticket's status
 * DELETE /tickets/:id                  → Delete a specific ticket
 * POST   /tickets/interactions         → Add internal interaction/notes to a ticket
 * POST   /tickets/manually-assigned    → Manually assign a ticket to an agent
 *
 * POST   /agents                       → Create a new agent
 * GET    /agents/deactivate/:id        → Deactivate an agent (soft delete)
 * GET    /agents                       → Get list of all agents
 * GET    /agents/unique                → Get list of unique/distinct agents
 * GET    /agents/:id                   → Get a specific agent by ID
 * PUT    /agents                      → Update agent details
 * DELETE /agents/:id                   → Delete an agent permanently
 */

import express from "express";
import {
  getAgents,
  getTicket,
  getTickets,
  createAgent,
  deleteAgent,
  updateAgent,
  deleteTicket,
  getAgentByID,
  createTicket,
  addInteraction,
  deactivateAgent,
  updateTicketStatus,
  manualAssignTicketToAgent,
} from "./support.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";
import { resolveChatStaffRole } from "../../utils/chatStaffRole";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const router = express.Router();

const requireActiveAdminEmployee = async (
  req: express.Request | any,
  res: express.Response,
  next: express.NextFunction,
) => {
  try {
    const staffRole = await resolveChatStaffRole(
      req.user?._id,
      req.user?.role,
    );
    if (staffRole !== "admin") {
      return res.status(403).json({
        success: false,
        status: 403,
        message: "Only an active admin employee can perform this action",
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

// AGENT ROUTES
router.post(
  "/agents",
  authenticateToken,
  requireActiveAdminEmployee,
  dynamicUpload([{ name: "profilePictureUrl", maxCount: 1 }]),
  s3UploaderMiddleware("profile"),
  asyncHandler(createAgent)
);

router.put(
  "/update-agent/:id",
  authenticateToken,
  requireActiveAdminEmployee,
  dynamicUpload([{ name: "profilePictureUrl", maxCount: 1 }]),
  s3UploaderMiddleware("profile"),
  asyncHandler(updateAgent)
);

router.get("/agents", authenticateToken, asyncHandler(getAgents));
router.get(
  "/agents/:id",
  authenticateToken,
  requireActiveAdminEmployee,
  asyncHandler(getAgentByID),
);
router.delete(
  "/agents/:id",
  authenticateToken,
  requireActiveAdminEmployee,
  asyncHandler(deleteAgent),
);
router.get(
  "/agents/deactivate/:id",
  authenticateToken,
  requireActiveAdminEmployee,
  asyncHandler(deactivateAgent)
);

// TICKET ROUTES
router.get("/tickets", authenticateToken, asyncHandler(getTickets));
router.get("/tickets/:id", authenticateToken, asyncHandler(getTicket));
router.post("/tickets", authenticateToken, asyncHandler(createTicket));
router.delete(
  "/tickets/:id",
  authenticateToken,
  requireActiveAdminEmployee,
  asyncHandler(deleteTicket),
);
router.post(
  "/tickets/interactions",
  authenticateToken,
  dynamicUpload([{ name: "media", maxCount: 5 }]),
  s3UploaderMiddleware("support-chat"),
  asyncHandler(addInteraction)
);
router.get(
  "/tickets/:id/:status",
  authenticateToken,
  asyncHandler(updateTicketStatus)
);
router.post(
  "/tickets/manually-assigned",
  authenticateToken,
  requireActiveAdminEmployee,
  asyncHandler(manualAssignTicketToAgent)
);

export default router;
