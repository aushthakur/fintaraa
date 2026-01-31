import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";
import { EligibilityCriteriaController } from "./eligibilityCriteria.controller";

const router = express.Router();

router
  .post(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityCriteriaController.create)
  )
  .post(
    "/send-mail",
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityCriteriaController.sendMail)
  )
  .get(
    "/",
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityCriteriaController.getAll)
  )
  .get(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityCriteriaController.getById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityCriteriaController.updateById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorize("admin"),
    asyncHandler(EligibilityCriteriaController.deleteById)
  );

export default router;
