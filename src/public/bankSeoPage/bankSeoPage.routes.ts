import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { BankSeoPageController } from "./bankSeoPage.controller";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router.get(
  "/public/:bankName/:product",
  asyncHandler(BankSeoPageController.resolvePublicPage),
);

router
  .route("/")
  .get(authenticateToken, asyncHandler(BankSeoPageController.getAllPages))
  .post(
    authenticateToken,
    authorize("admin"),
    asyncHandler(BankSeoPageController.createPage),
  );

router
  .route("/:id")
  .get(authenticateToken, asyncHandler(BankSeoPageController.getPageById))
  .put(
    authenticateToken,
    authorize("admin"),
    asyncHandler(BankSeoPageController.updatePage),
  )
  .delete(
    authenticateToken,
    authorize("admin"),
    asyncHandler(BankSeoPageController.deletePage),
  );

export default router;
