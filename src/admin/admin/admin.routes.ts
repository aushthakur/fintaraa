import { Router } from "express";
import { AdminController } from "./admin.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";

const userRouter = Router();

// Public routes
userRouter.post("/", asyncHandler(AdminController.createAdmin));
userRouter.post("/login", asyncHandler(AdminController.loginAdmin));
userRouter.route("/").get(asyncHandler(AdminController.getAllAdmins));
userRouter.get(
  "/current/admin",
  authenticateToken,
  asyncHandler(AdminController.getCurrentAdmin)
);

// ==================== LANDER ROUTES ====================
// Public route - Lander login (must be before /:id route)
userRouter.post("/lander/login", asyncHandler(AdminController.loginLander));

userRouter.get(
  "/current/lander",
  authenticateToken,
  asyncHandler(AdminController.getCurrentLander)
);
// Lander CRUD routes (must be before /:id route)
userRouter
  .route("/lander")
  .post(
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "profilePictureUrl", maxCount: 1 }]),
    s3UploaderMiddleware("profile"),
    asyncHandler(AdminController.createLander)
  )
  .get(
    authenticateToken,
    authorize("admin"),
    asyncHandler(AdminController.getAllLanders)
  );

userRouter
  .route("/lander/:id")
  .get(
    authenticateToken,
    authorize("admin"),
    asyncHandler(AdminController.getLanderById)
  )
  .put(
    authenticateToken,
    authorize("admin"),
    dynamicUpload([{ name: "profilePictureUrl", maxCount: 1 }]),
    s3UploaderMiddleware("profile"),
    asyncHandler(AdminController.updateLanderById)
  )
  .delete(
    authenticateToken,
    authorize("admin"),
    asyncHandler(AdminController.deleteLanderById)
  );

userRouter.put(
  "/lander/:id/password",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminController.updateLanderPassword)
);

// ==================== AGENT ROUTES ====================
// Public route - Agent login (must be before /:id route)
userRouter.post("/agent/login", asyncHandler(AdminController.loginAgent));

userRouter.get(
  "/current/agent",
  authenticateToken,
  asyncHandler(AdminController.getCurrentAgent)
);

// Admin routes (parameterized routes must come last)
userRouter.put(
  "/:id/status",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminController.updateAdminStatus)
);
userRouter.put(
  "/:id/password",
  authenticateToken,
  authorize("admin"),
  asyncHandler(AdminController.updateAdminPassword)
);
userRouter
  .route("/:id")
  .get(asyncHandler(AdminController.getAdminById)) // GET /:id
  .put(asyncHandler(AdminController.updateAdmin)); // PUT /:id

export default userRouter;
