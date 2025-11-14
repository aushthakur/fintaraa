import { Router } from "express";

import faqRoutes from "../admin/faq/faq.routes";
import blogRoutes from "../admin/blog/blog.routes";
import roleRoutes from "../admin/role/role.routes";
import userRoutes from "../public/user/user.routes";
import adminRoutes from "../admin/admin/admin.routes";
import cibilRoutes from "../public/cibil/cibil.routes";
import bannerRoutes from "../admin/banner/banner.routes";
import supportRoutes from "../public/support/support.routes";
import stateCityRoutes from "../public/statecity/statecity.routes";
import FaqCategoryRoutes from "../admin/faqcategory/faqcategory.routes";
import testimonialRoutes from "../admin/testimonial/testimonial.routes";
import abusereportRoutes from "../public/abusereport/abusereport.routes";
import blogcategoryRoutes from "../admin/blogcategory/blogcategory.routes";

const router = Router();

router.use("/faq", faqRoutes);
router.use("/blog", blogRoutes);
router.use("/user", userRoutes);
router.use("/role", roleRoutes);
router.use("/admin", adminRoutes);
router.use("/cibil", cibilRoutes);
router.use("/banner", bannerRoutes);
router.use("/support", supportRoutes);
router.use("/location", stateCityRoutes);
router.use("/faqcategory", FaqCategoryRoutes);
router.use("/testimonial", testimonialRoutes);
router.use("/abusereport", abusereportRoutes);
router.use("/blogcategory", blogcategoryRoutes);

export default router;
