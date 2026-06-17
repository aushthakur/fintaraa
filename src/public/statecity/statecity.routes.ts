import express from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { StateCityController } from "./statecity.controller";
import { authenticateToken } from "../../middlewares/authMiddleware";

const {
  // Country
  createCountry,
  getAllCountries,
  getCountryById,
  updateCountryById,
  deleteCountryById,

  // State
  createState,
  getAllStates,
  getStateById,
  updateStateById,
  deleteStateById,

  // City
  createCity,
  getAllCity,
  getCityById,
  updateCityById,
  deleteCityById,

  // Pincode
  createPincode,
  getAllPincodes,
  getPincodeById,
  updatePincodeById,
  deletePincodeById,

  // Area
  createArea,
  getAllAreas,
  getAreaById,
  updateAreaById,
  deleteAreaById,

  // Combined
  createStateCity,
  getAllStateCitys,
} = StateCityController;

const router = express.Router();

// ==============================
// 🌍 Country Routes
// ==============================
router.post("/country", authenticateToken, asyncHandler(createCountry));
router.get("/country", authenticateToken, asyncHandler(getAllCountries));
router.get("/country/:id", authenticateToken, asyncHandler(getCountryById));
router.put("/country/:id", authenticateToken, asyncHandler(updateCountryById));
router.delete("/country/:id", authenticateToken, asyncHandler(deleteCountryById));

// ==============================
// 📍 State Routes
// ==============================
router.post("/state", authenticateToken, asyncHandler(createState));
router.get("/state", authenticateToken, asyncHandler(getAllStates));
router.get("/state/:id", authenticateToken, asyncHandler(getStateById));
router.put("/state/:id", authenticateToken, asyncHandler(updateStateById));
router.delete("/state/:id", authenticateToken, asyncHandler(deleteStateById));

// ==============================
// 🏙️ City Routes
// ==============================
router.post("/city", authenticateToken, asyncHandler(createCity));
router.get("/city", authenticateToken, asyncHandler(getAllCity));
router.get("/city/:id", authenticateToken, asyncHandler(getCityById));
router.put("/city/:id", authenticateToken, asyncHandler(updateCityById));
router.delete("/city/:id", authenticateToken, asyncHandler(deleteCityById));

// ==============================
// 📮 Pincode Routes
// ==============================
router.post("/pincode", authenticateToken, asyncHandler(createPincode));
router.get("/pincode", authenticateToken, asyncHandler(getAllPincodes));
router.get("/pincode/:id", authenticateToken, asyncHandler(getPincodeById));
router.put("/pincode/:id", authenticateToken, asyncHandler(updatePincodeById));
router.delete("/pincode/:id", authenticateToken, asyncHandler(deletePincodeById));

// ==============================
// 🧭 Area Routes
// ==============================
router.post("/area", authenticateToken, asyncHandler(createArea));
router.get("/area", authenticateToken, asyncHandler(getAllAreas));
router.get("/area/:id", authenticateToken, asyncHandler(getAreaById));
router.put("/area/:id", authenticateToken, asyncHandler(updateAreaById));
router.delete("/area/:id", authenticateToken, asyncHandler(deleteAreaById));

// ==============================
// 🌐 Combined Route (Optional)
// ==============================
router.post("/", authenticateToken, asyncHandler(createStateCity));
router.get("/", authenticateToken, asyncHandler(getAllStateCitys));

export default router;
