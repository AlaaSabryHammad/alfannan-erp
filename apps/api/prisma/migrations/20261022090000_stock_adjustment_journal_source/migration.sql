-- Stock counts and manual stock adjustments now post to the ledger
ALTER TYPE "JournalSource" ADD VALUE IF NOT EXISTS 'STOCK_ADJUSTMENT';
