-- Barcode Generator "label-first" pool: numbers minted (and printed) before
-- any product exists, so a physical label can go on stock ahead of the data
-- entry. createProduct flips the matching row to 'assigned' once a product
-- is created with that barcode — see products.controller.ts.

CREATE TYPE "GeneratedBarcodeStatus" AS ENUM ('unused', 'assigned');

CREATE TABLE "generated_barcodes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "status" "GeneratedBarcodeStatus" NOT NULL DEFAULT 'unused',
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_product_id" INTEGER,
    "assigned_at" TIMESTAMP(3),

    CONSTRAINT "generated_barcodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "generated_barcodes_code_key" ON "generated_barcodes"("code");
CREATE UNIQUE INDEX "generated_barcodes_assigned_product_id_key" ON "generated_barcodes"("assigned_product_id");
CREATE INDEX "generated_barcodes_status_idx" ON "generated_barcodes"("status");

ALTER TABLE "generated_barcodes" ADD CONSTRAINT "generated_barcodes_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generated_barcodes" ADD CONSTRAINT "generated_barcodes_assigned_product_id_fkey"
  FOREIGN KEY ("assigned_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
