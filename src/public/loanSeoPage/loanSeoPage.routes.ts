import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { LoanSeoPageController } from "./loanSeoPage.controller";

const router = express.Router();

router.get(
  "/public/:loanType",
  asyncHandler(LoanSeoPageController.resolvePublicPage),
);

router
  .route("/")
  .get(authenticateToken, asyncHandler(LoanSeoPageController.getAllPages))
  .post(
    authenticateToken,
    authorize("admin"),
    asyncHandler(LoanSeoPageController.createPage),
  );

router
  .route("/:id")
  .get(authenticateToken, asyncHandler(LoanSeoPageController.getPageById))
  .put(
    authenticateToken,
    authorize("admin"),
    asyncHandler(LoanSeoPageController.updatePage),
  )
  .delete(
    authenticateToken,
    authorize("admin"),
    asyncHandler(LoanSeoPageController.deletePage),
  );

export default router;
