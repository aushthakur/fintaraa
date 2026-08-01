import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { PublicPartnerController } from "./partner.controller";

const router = Router();

router.get("/public", asyncHandler(PublicPartnerController.list));
router.get("/public/:slug/products", asyncHandler(PublicPartnerController.products));
router.get("/public/:slug", asyncHandler(PublicPartnerController.detail));

export default router;
