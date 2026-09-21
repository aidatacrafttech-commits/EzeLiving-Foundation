import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { generateBarcodeNumber } from "../services/barcodeNumber";

const MAX_BATCH = 500;

const generateSchema = z.object({
  count: z.number().int().min(1).max(MAX_BATCH),
  material: z.enum(["MB", "GL", "OT"]).optional(),
});

// Mints `count` brand-new, guaranteed-unique barcode numbers up front — no
// product needs to exist yet. Each is inserted as 'unused'; createProduct
// later flips the matching row to 'assigned' once a real product is created
// with that code (see products.controller.ts). Sequential numbers generated
// one at a time inside a single transaction, same pattern as every other
// document-number counter in this app.
export const generateBarcodes = asyncHandler(async (req: Request, res: Response) => {
  const { count, material } = generateSchema.parse(req.body);
  const actor = req.user!;

  const codes = await prisma.$transaction(
    async (tx) => {
      const created: string[] = [];
      for (let i = 0; i < count; i++) {
        const code = await generateBarcodeNumber(tx, material);
        await tx.generatedBarcode.create({
          data: { code, createdById: actor.id },
        });
        created.push(code);
      }
      return created;
    },
    { timeout: 20000, maxWait: 10000 }
  );

  res.status(201).json({ codes });
});

const listQuerySchema = z.object({
  status: z.enum(["unused", "assigned"]).optional(),
});

export const listGeneratedBarcodes = asyncHandler(async (req: Request, res: Response) => {
  const { status } = listQuerySchema.parse({ status: req.query.status || undefined });

  const rows = await prisma.generatedBarcode.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { assignedProduct: { select: { id: true, name: true, sku: true } } },
  });
  res.json(rows);
});
