ALTER TABLE "products"
ADD CONSTRAINT "products_available_check"
CHECK ("available" >= 0);