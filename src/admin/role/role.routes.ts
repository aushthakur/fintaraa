import express from "express";
import { RoleController } from "./role.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const { createRole, getAllRoles, getRoleById, updateRoleById, deleteRoleById } =
  RoleController;

const router = express.Router();

router
  .get("/", authenticateToken, authorize("admin"), asyncHandler(getAllRoles))
  .post("/", authenticateToken, authorize("admin"), asyncHandler(createRole))
  .get("/:id", authenticateToken, authorize("admin"), asyncHandler(getRoleById))
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(updateRoleById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(deleteRoleById)
  );

export default router;
