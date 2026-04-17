import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  authenticateToken,
  authorizePermission,
} from "../../middlewares/authMiddleware";
import { EligibilityCriteriaController } from "./eligibilityCriteria.controller";

const router = express.Router();

router
  .post(
    "/",
    authenticateToken,
    authorizePermission("Eligibility Criteria"),
    asyncHandler(EligibilityCriteriaController.create)
  )
  .post(
    "/send-mail",
    authenticateToken,
    authorizePermission("Eligibility Criteria"),
    asyncHandler(EligibilityCriteriaController.sendMail)
  )
  .get(
    "/",
    authenticateToken,
    authorizePermission("Eligibility Criteria"),
    asyncHandler(EligibilityCriteriaController.getAll)
  )
  .get(
    "/:id",
    authenticateToken,
    authorizePermission("Eligibility Criteria"),
    asyncHandler(EligibilityCriteriaController.getById)
  )
  .put(
    "/:id",
    authenticateToken,
    authorizePermission("Eligibility Criteria"),
    asyncHandler(EligibilityCriteriaController.updateById)
  )
  .delete(
    "/:id",
    authenticateToken,
    authorizePermission("Eligibility Criteria"),
    asyncHandler(EligibilityCriteriaController.deleteById)
  );

export default router;
