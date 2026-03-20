ALTER TABLE app.food_log_item
  ADD COLUMN IF NOT EXISTS review_meta JSONB NOT NULL DEFAULT 'null'::jsonb;
