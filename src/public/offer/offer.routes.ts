import express from "express";
import { OfferController } from "./offer.controller";
import { asyncHandler } from "../../utils/asyncHandler";
import { authenticateToken, authorize } from "../../middlewares/authMiddleware";

const router = express.Router();

router.get("/public", asyncHandler(OfferController.getPublicOffers));

router.get(
  "/eligible",
  authenticateToken,
  asyncHandler(OfferController.getEligibleOffers)
);

router.get(
  "/applications/me",
  authenticateToken,
  asyncHandler(OfferController.getMyApplications)
);

router.post(
  "/:id/apply",
  authenticateToken,
  asyncHandler(OfferController.applyForOffer)
);

router
  .route("/:id")
  .get(
    authenticateToken,
    authorize("admin"),
    asyncHandler(OfferController.getOfferById)
  )
  .put(
    authenticateToken,
    authorize("admin"),
    asyncHandler(OfferController.updateOffer)
  )
  .delete(
    authenticateToken,
    authorize("admin"),
    asyncHandler(OfferController.deleteOffer)
  );

router
  .route("/")
  .get(
    authenticateToken,
    authorize("admin"),
    asyncHandler(OfferController.getOffers)
  )
  .post(
    authenticateToken,
    authorize("admin"),
    asyncHandler(OfferController.createOffer)
  );

export default router;
