-- Add tsvector column to orders
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS fts tsvector;

-- Update with data from display_id, guest fields, and customer relation
UPDATE "Order" SET fts = (
  to_tsvector('simple',
    coalesce("displayId", '') || ' ' ||
    coalesce("guestName", '') || ' ' ||
    coalesce("guestPhone", '') || ' ' ||
    coalesce((SELECT "firstName" FROM "User" WHERE "User".id = "Order"."customerId"), '') || ' ' ||
    coalesce((SELECT "lastName" FROM "User" WHERE "User".id = "Order"."customerId"), '') || ' ' ||
    coalesce((SELECT "phoneNumber" FROM "User" WHERE "User".id = "Order"."customerId"), '')
  )
);

CREATE INDEX orders_fts_idx ON "Order" USING GIN(fts);

-- Auto-update trigger on orders
CREATE OR REPLACE FUNCTION orders_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('simple',
    coalesce(NEW."displayId", '') || ' ' ||
    coalesce(NEW."guestName", '') || ' ' ||
    coalesce(NEW."guestPhone", '') || ' ' ||
    coalesce((SELECT "firstName" FROM "User" WHERE "User".id = NEW."customerId"), '') || ' ' ||
    coalesce((SELECT "lastName" FROM "User" WHERE "User".id = NEW."customerId"), '') || ' ' ||
    coalesce((SELECT "phoneNumber" FROM "User" WHERE "User".id = NEW."customerId"), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_fts ON "Order";
CREATE TRIGGER trg_orders_fts
  BEFORE INSERT OR UPDATE OF "displayId", "guestName", "guestPhone", "customerId"
  ON "Order" FOR EACH ROW EXECUTE FUNCTION orders_fts_update();

-- Products
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS fts tsvector;

UPDATE "Product" SET fts = to_tsvector('simple',
  coalesce("name", '') || ' ' || coalesce("sku", '')
);

CREATE INDEX products_fts_idx ON "Product" USING GIN(fts);

CREATE OR REPLACE FUNCTION products_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('simple', coalesce(NEW."name", '') || ' ' || coalesce(NEW."sku", ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_fts ON "Product";
CREATE TRIGGER trg_products_fts
  BEFORE INSERT OR UPDATE OF "name", "sku"
  ON "Product" FOR EACH ROW EXECUTE FUNCTION products_fts_update();

-- Users (customers)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS fts tsvector;

UPDATE "User" SET fts = to_tsvector('simple',
  coalesce("firstName", '') || ' ' ||
  coalesce("lastName", '') || ' ' ||
  coalesce("email", '') || ' ' ||
  coalesce("phoneNumber", '')
);

CREATE INDEX users_fts_idx ON "User" USING GIN(fts);

CREATE OR REPLACE FUNCTION users_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('simple',
    coalesce(NEW."firstName", '') || ' ' ||
    coalesce(NEW."lastName", '') || ' ' ||
    coalesce(NEW."email", '') || ' ' ||
    coalesce(NEW."phoneNumber", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_fts ON "User";
CREATE TRIGGER trg_users_fts
  BEFORE INSERT OR UPDATE OF "firstName", "lastName", "email", "phoneNumber"
  ON "User" FOR EACH ROW EXECUTE FUNCTION users_fts_update();
