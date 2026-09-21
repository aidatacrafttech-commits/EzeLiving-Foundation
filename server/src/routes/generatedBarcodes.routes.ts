import { Router } from "express";
import { generateBarcodes, listGeneratedBarcodes } from "../controllers/generatedBarcodes.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

// Same access level as Products (admin or staff) — this pool is just the
// "label-first" half of adding a product, not a separately privileged area.
router.get("/", authenticate, listGeneratedBarcodes);
router.post("/generate", authenticate, generateBarcodes);

export default router;
