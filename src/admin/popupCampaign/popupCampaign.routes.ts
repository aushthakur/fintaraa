import { NextFunction, Request, Response, Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  authenticateToken,
  authorize,
  optionalAuthenticateToken,
} from "../../middlewares/authMiddleware";
import {
  dynamicUpload,
  s3UploaderMiddleware,
} from "../../middlewares/s3FileUploadMiddleware";
import { mediaUrlMiddleware } from "../../middlewares/mediaUrlMiddleware";
import { PopupCampaign } from "../../modals/popupCampaign.model";
import { PopupCampaignController } from "./popupCampaign.controller";
import ApiError from "../../utils/ApiError";

const router = Router();

const validatePopupImage = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const images = [
    ...(files?.imageUrl || []),
    ...(files?.mobileImageUrl || []),
  ];
  const invalid = images.find(
    (file) => !file.mimetype.startsWith("image/") || file.size > 5 * 1024 * 1024,
  );
  if (invalid) {
    return res
      .status(400)
      .json(new ApiError(400, "Popup image must be an image up to 5 MB"));
  }
  return next();
};

const uploadPipeline = [
  dynamicUpload([
    { name: "imageUrl", maxCount: 1 },
    { name: "mobileImageUrl", maxCount: 1 },
  ]),
  validatePopupImage,
  s3UploaderMiddleware("popup"),
  asyncHandler(
    mediaUrlMiddleware(PopupCampaign, [
      { key: "imageUrl", type: "single", useExtractOnUpdate: true },
      { key: "mobileImageUrl", type: "single", useExtractOnUpdate: true },
    ]),
  ),
];

router.get("/public", asyncHandler(PopupCampaignController.publicList));
router.post(
  "/:id/submissions",
  optionalAuthenticateToken,
  asyncHandler(PopupCampaignController.submit),
);

router.get(
  "/submissions",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PopupCampaignController.submissions),
);
router.get(
  "/",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PopupCampaignController.adminList),
);
router.post(
  "/",
  authenticateToken,
  authorize("admin"),
  ...uploadPipeline,
  asyncHandler(PopupCampaignController.create),
);
router.put(
  "/:id",
  authenticateToken,
  authorize("admin"),
  ...uploadPipeline,
  asyncHandler(PopupCampaignController.update),
);
router.delete(
  "/:id",
  authenticateToken,
  authorize("admin"),
  asyncHandler(PopupCampaignController.remove),
);

export default router;
