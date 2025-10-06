import { Router } from "express";
import { AdminController } from "./admin.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken } from "../../middlewares/authMiddleware";

const userRouter = Router();

// Public routes
userRouter.post("/", asyncHandler(AdminController.createAdmin));
userRouter.post("/login", asyncHandler(AdminController.loginAdmin));
userRouter.route("/").get(asyncHandler(AdminController.getAllAdmins));
userRouter.get(
  "/current/user",
  authenticateToken,
  asyncHandler(AdminController.getCurrentAdmin)
);
userRouter
  .route("/:id")
  .get(asyncHandler(AdminController.getAdminById)) // GET /:id
  .put(asyncHandler(AdminController.updateAdmin)); // PUT /:id

export default userRouter;
