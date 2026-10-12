-- Moving-average cost keeps 4 decimals: with 2, every purchase rounded the average and the inventory
-- account drifted away from quantity × cost. Widening only; existing values are unchanged.
ALTER TABLE "Product" ALTER COLUMN "costPrice" TYPE DECIMAL(14,4);
ALTER TABLE "SalesInvoiceItem" ALTER COLUMN "unitCost" TYPE DECIMAL(14,4);
