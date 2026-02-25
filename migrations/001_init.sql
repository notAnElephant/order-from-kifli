CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  telegram_message_id INTEGER,
  approved_at TEXT,
  rejected_at TEXT,
  ordered_at TEXT,
  order_result_json TEXT
);

CREATE TABLE IF NOT EXISTS proposal_recipes (
  proposal_id TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  recipe_name TEXT NOT NULL,
  dominant_ingredients_json TEXT NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (proposal_id, recipe_id),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS proposal_cart_lines (
  proposal_id TEXT NOT NULL,
  product_id TEXT,
  ingredient_name TEXT NOT NULL,
  product_name TEXT,
  quantity REAL,
  unit TEXT,
  estimated_price REAL,
  discounted_price REAL,
  matched INTEGER NOT NULL,
  notes TEXT,
  PRIMARY KEY (proposal_id, ingredient_name, product_id),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON proposals(created_at);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
