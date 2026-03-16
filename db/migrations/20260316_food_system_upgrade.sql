CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS core.portion_reference (
  id BIGSERIAL PRIMARY KEY,
  food_name_zh TEXT NOT NULL,
  normalized_name_zh TEXT NOT NULL,
  default_grams NUMERIC(12, 4) NOT NULL,
  unit_grams JSONB NOT NULL DEFAULT '{}'::jsonb,
  keyword_patterns TEXT[] NOT NULL DEFAULT '{}'::text[],
  reference_source TEXT NOT NULL,
  notes TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portion_reference_normalized_name
  ON core.portion_reference (normalized_name_zh);

CREATE INDEX IF NOT EXISTS idx_portion_reference_keywords
  ON core.portion_reference USING GIN (keyword_patterns);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_food_alias_lookup_unique
  ON core.canonical_food_alias (canonical_food_id, normalized_alias, language_code, provenance);

CREATE INDEX IF NOT EXISTS idx_canonical_food_alias_trgm
  ON core.canonical_food_alias
  USING GIN (normalized_alias gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_recipe_alias_trgm
  ON core.recipe_alias
  USING GIN (normalized_alias gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_canonical_food_name_zh_trgm
  ON core.canonical_food
  USING GIN (display_name_zh gin_trgm_ops);

CREATE TABLE IF NOT EXISTS app."user" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.magic_link_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app."user"(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_magic_link_token_lookup
  ON app.magic_link_token (token_hash, expires_at);

CREATE TABLE IF NOT EXISTS app.session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app."user"(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_lookup
  ON app.session (session_hash, expires_at);

CREATE TABLE IF NOT EXISTS app.food_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app."user"(id) ON DELETE CASCADE,
  source_description TEXT,
  eaten_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eaten_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_log_user_date
  ON app.food_log (user_id, eaten_on DESC, eaten_at DESC);

CREATE TABLE IF NOT EXISTS app.food_log_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_log_id UUID NOT NULL REFERENCES app.food_log(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  quantity_description TEXT NOT NULL DEFAULT '未知',
  estimated_grams NUMERIC(12, 4) NOT NULL DEFAULT 0,
  confidence NUMERIC(6, 4) NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL,
  source_label TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'ai_fallback',
  source_status TEXT NOT NULL DEFAULT 'published',
  amount_basis_g NUMERIC(12, 4) NOT NULL DEFAULT 100,
  validation_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  energy_kcal NUMERIC(12, 4) NOT NULL DEFAULT 0,
  protein_grams NUMERIC(12, 4) NOT NULL DEFAULT 0,
  carbohydrate_grams NUMERIC(12, 4) NOT NULL DEFAULT 0,
  fat_grams NUMERIC(12, 4) NOT NULL DEFAULT 0,
  total_energy_kcal NUMERIC(12, 4) NOT NULL DEFAULT 0,
  total_protein_grams NUMERIC(12, 4) NOT NULL DEFAULT 0,
  total_carbohydrate_grams NUMERIC(12, 4) NOT NULL DEFAULT 0,
  total_fat_grams NUMERIC(12, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_log_item_log
  ON app.food_log_item (food_log_id);

CREATE TABLE IF NOT EXISTS app.rate_limit_bucket (
  subject_key TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_key, window_started_at)
);

INSERT INTO core.portion_reference (
  food_name_zh,
  normalized_name_zh,
  default_grams,
  unit_grams,
  keyword_patterns,
  reference_source,
  notes,
  priority
)
VALUES
  ('苹果', '苹果', 220, '{"个": 220, "只": 220, "块": 110}'::jsonb, ARRAY['苹果'], '中国食物成分表常见份量', '中等鲜苹果', 10),
  ('香蕉', '香蕉', 120, '{"根": 120, "只": 120}'::jsonb, ARRAY['香蕉'], '中国食物成分表常见份量', '去皮可食部近似', 10),
  ('橙子', '橙子', 200, '{"个": 200, "只": 200}'::jsonb, ARRAY['橙子'], '中国食物成分表常见份量', '中等橙', 10),
  ('梨', '梨', 230, '{"个": 230, "只": 230}'::jsonb, ARRAY['梨'], '中国食物成分表常见份量', '中等雪梨/香梨近似', 10),
  ('桃子', '桃子', 180, '{"个": 180, "只": 180}'::jsonb, ARRAY['桃子'], '中国食物成分表常见份量', '中等桃', 10),
  ('芒果', '芒果', 260, '{"个": 260, "只": 260}'::jsonb, ARRAY['芒果'], '中国食物成分表常见份量', '中等芒果', 10),
  ('西瓜', '西瓜', 280, '{"块": 280, "片": 180}'::jsonb, ARRAY['西瓜'], '中国食物成分表常见份量', '常见切块', 10),
  ('葡萄', '葡萄', 120, '{"串": 120, "颗": 8}'::jsonb, ARRAY['葡萄'], '中国食物成分表常见份量', '一小串/单颗可食部', 10),
  ('草莓', '草莓', 150, '{"盒": 250, "颗": 18}'::jsonb, ARRAY['草莓'], '中国食物成分表常见份量', '单颗可食部近似', 10),
  ('猕猴桃', '猕猴桃', 100, '{"个": 100, "只": 100}'::jsonb, ARRAY['猕猴桃'], '中国食物成分表常见份量', '中等猕猴桃', 10),
  ('鸡蛋', '鸡蛋', 50, '{"个": 50, "只": 50, "颗": 50}'::jsonb, ARRAY['鸡蛋', '煮蛋', '蒸蛋', '炒蛋'], '中国食物成分表常见份量', '去壳单枚近似', 10),
  ('鸭蛋', '鸭蛋', 70, '{"个": 70, "只": 70, "颗": 70}'::jsonb, ARRAY['鸭蛋'], '中国食物成分表常见份量', '单枚近似', 10),
  ('牛奶', '牛奶', 250, '{"杯": 250, "盒": 250, "瓶": 250, "ml": 1, "毫升": 1}'::jsonb, ARRAY['牛奶', '纯牛奶'], '中国食物成分表常见份量', '常见杯装/盒装', 10),
  ('酸奶', '酸奶', 250, '{"杯": 250, "盒": 250, "瓶": 250, "ml": 1, "毫升": 1}'::jsonb, ARRAY['酸奶'], '中国食物成分表常见份量', '常见杯装/盒装', 10),
  ('豆浆', '豆浆', 300, '{"杯": 300, "碗": 300, "盒": 250, "瓶": 300, "ml": 1, "毫升": 1}'::jsonb, ARRAY['豆浆'], '中国食物成分表常见份量', '早餐店一杯近似', 10),
  ('米饭', '米饭', 180, '{"碗": 180, "份": 180}'::jsonb, ARRAY['米饭', '白饭'], '中国食物成分表常见份量', '一小碗熟米饭', 10),
  ('炒饭', '炒饭', 320, '{"盘": 320, "份": 320}'::jsonb, ARRAY['炒饭', '蛋炒饭'], '中国食物成分表常见份量', '一盘炒饭', 15),
  ('拉面', '拉面', 420, '{"碗": 420, "份": 420}'::jsonb, ARRAY['拉面', '汤面'], '中国食物成分表常见份量', '含汤一碗成品', 15),
  ('面条', '面条', 320, '{"碗": 320, "份": 320}'::jsonb, ARRAY['面条', '拌面', '炒面', '意面'], '中国食物成分表常见份量', '一碗/一份熟面', 20),
  ('米线', '米线', 380, '{"碗": 380, "份": 380}'::jsonb, ARRAY['米线', '河粉', '粉'], '中国食物成分表常见份量', '一碗粉类主食', 20),
  ('白粥', '白粥', 300, '{"碗": 300, "杯": 300}'::jsonb, ARRAY['粥', '白粥', '小米粥', '南瓜粥'], '中国食物成分表常见份量', '一碗粥', 20),
  ('排骨汤', '排骨汤', 450, '{"碗": 450, "份": 450}'::jsonb, ARRAY['排骨汤', '骨头汤', '汤'], '中国食物成分表常见份量', '连汤带料一碗', 25),
  ('紫菜蛋花汤', '紫菜蛋花汤', 320, '{"碗": 320, "份": 320}'::jsonb, ARRAY['紫菜蛋花汤', '蛋花汤'], '中国食物成分表常见份量', '一碗汤', 20),
  ('包子', '包子', 110, '{"个": 110, "只": 110}'::jsonb, ARRAY['包子'], '中国食物成分表常见份量', '普通包子', 10),
  ('肉包子', '肉包子', 120, '{"个": 120, "只": 120}'::jsonb, ARRAY['肉包', '肉包子', '鲜肉包子'], '中国食物成分表常见份量', '鲜肉包', 10),
  ('菜包子', '菜包子', 110, '{"个": 110, "只": 110}'::jsonb, ARRAY['菜包', '菜包子'], '中国食物成分表常见份量', '蔬菜包子', 10),
  ('小笼包', '小笼包', 35, '{"个": 35, "只": 35}'::jsonb, ARRAY['小笼包'], '中国食物成分表常见份量', '单枚小笼', 10),
  ('馒头', '馒头', 100, '{"个": 100, "只": 100}'::jsonb, ARRAY['馒头'], '中国食物成分表常见份量', '普通馒头', 10),
  ('面包', '面包', 80, '{"片": 30, "个": 80, "只": 80}'::jsonb, ARRAY['面包', '吐司', '法棍'], '中国食物成分表常见份量', '常见面包份量', 20),
  ('蛋糕', '蛋糕', 90, '{"块": 90, "片": 90, "份": 100}'::jsonb, ARRAY['蛋糕'], '中国食物成分表常见份量', '普通切块蛋糕', 10),
  ('芝士蛋糕', '芝士蛋糕', 100, '{"块": 100, "片": 100, "份": 100}'::jsonb, ARRAY['芝士蛋糕', '慕斯蛋糕'], '中国食物成分表常见份量', '甜点店单片', 15),
  ('披萨', '披萨', 320, '{"份": 320, "片": 120, "块": 120}'::jsonb, ARRAY['披萨'], '中国食物成分表常见份量', '单人份披萨/2-3片', 10),
  ('汉堡', '汉堡', 220, '{"个": 220, "只": 220}'::jsonb, ARRAY['汉堡', '堡'], '中国食物成分表常见份量', '常见鸡腿堡/牛肉堡', 20),
  ('三明治', '三明治', 180, '{"个": 180, "份": 180}'::jsonb, ARRAY['三明治'], '中国食物成分表常见份量', '便利店/轻食店单份', 20),
  ('鸡胸肉', '鸡胸肉', 150, '{"块": 150, "片": 90, "份": 150}'::jsonb, ARRAY['鸡胸肉', '鸡胸'], '中国食物成分表常见份量', '熟制单份', 10),
  ('牛排', '牛排', 180, '{"块": 180, "片": 180, "份": 180}'::jsonb, ARRAY['牛排'], '中国食物成分表常见份量', '西式单份', 10),
  ('鱼排', '鱼排', 150, '{"块": 150, "片": 150, "份": 150}'::jsonb, ARRAY['鱼排'], '中国食物成分表常见份量', '西式单份', 10),
  ('宫保鸡丁', '宫保鸡丁', 220, '{"盘": 220, "份": 220}'::jsonb, ARRAY['宫保鸡丁'], '中国食物成分表常见份量', '家常菜单盘', 10),
  ('番茄炒蛋', '番茄炒蛋', 200, '{"盘": 200, "份": 200}'::jsonb, ARRAY['番茄炒蛋', '西红柿炒蛋'], '中国食物成分表常见份量', '家常菜单盘', 10),
  ('红烧肉', '红烧肉', 180, '{"盘": 180, "份": 180}'::jsonb, ARRAY['红烧肉'], '中国食物成分表常见份量', '家常菜单盘', 10),
  ('回锅肉', '回锅肉', 200, '{"盘": 200, "份": 200}'::jsonb, ARRAY['回锅肉'], '中国食物成分表常见份量', '家常菜单盘', 10),
  ('麻婆豆腐', '麻婆豆腐', 220, '{"盘": 220, "份": 220}'::jsonb, ARRAY['麻婆豆腐'], '中国食物成分表常见份量', '家常菜单盘', 10),
  ('鱼香肉丝', '鱼香肉丝', 220, '{"盘": 220, "份": 220}'::jsonb, ARRAY['鱼香肉丝'], '中国食物成分表常见份量', '家常菜单盘', 10),
  ('烤羊肉串', '烤羊肉串', 35, '{"串": 35, "根": 35}'::jsonb, ARRAY['烤羊肉串', '羊肉串'], '中国食物成分表常见份量', '单串熟重近似', 10),
  ('烤牛肉串', '烤牛肉串', 35, '{"串": 35, "根": 35}'::jsonb, ARRAY['烤牛肉串', '牛肉串'], '中国食物成分表常见份量', '单串熟重近似', 10),
  ('烤鸡翅', '烤鸡翅', 85, '{"个": 85, "只": 85, "串": 85}'::jsonb, ARRAY['烤鸡翅', '鸡翅'], '中国食物成分表常见份量', '单只中翅近似', 10),
  ('玉米', '玉米', 180, '{"根": 180, "只": 180}'::jsonb, ARRAY['玉米'], '中国食物成分表常见份量', '整根熟玉米', 10),
  ('红薯', '红薯', 220, '{"个": 220, "只": 220, "块": 110}'::jsonb, ARRAY['红薯'], '中国食物成分表常见份量', '中等红薯', 10),
  ('土豆', '土豆', 180, '{"个": 180, "只": 180, "块": 90}'::jsonb, ARRAY['土豆'], '中国食物成分表常见份量', '中等土豆', 10),
  ('油条', '油条', 55, '{"根": 55, "条": 55}'::jsonb, ARRAY['油条'], '中国食物成分表常见份量', '早餐单根', 10),
  ('煎饼果子', '煎饼果子', 260, '{"个": 260, "份": 260}'::jsonb, ARRAY['煎饼果子'], '中国食物成分表常见份量', '早餐摊单份', 10),
  ('手抓饼', '手抓饼', 160, '{"个": 160, "份": 160}'::jsonb, ARRAY['手抓饼'], '中国食物成分表常见份量', '单份', 10),
  ('饺子', '饺子', 25, '{"个": 25, "只": 25}'::jsonb, ARRAY['饺子', '水饺', '煎饺'], '中国食物成分表常见份量', '单只熟饺子', 15),
  ('馄饨', '馄饨', 18, '{"个": 18, "只": 18, "碗": 240}'::jsonb, ARRAY['馄饨'], '中国食物成分表常见份量', '单只/一碗近似', 15),
  ('汤圆', '汤圆', 28, '{"个": 28, "只": 28, "碗": 220}'::jsonb, ARRAY['汤圆', '元宵'], '中国食物成分表常见份量', '单枚熟重近似', 15),
  ('粽子', '粽子', 180, '{"个": 180, "只": 180}'::jsonb, ARRAY['粽子'], '中国食物成分表常见份量', '常见真空/鲜粽单只', 10),
  ('奶茶', '奶茶', 500, '{"杯": 500, "瓶": 500, "ml": 1, "毫升": 1}'::jsonb, ARRAY['奶茶'], '现制饮品常见份量', '大杯奶茶', 20),
  ('可乐', '可乐', 330, '{"罐": 330, "瓶": 500, "杯": 330, "ml": 1, "毫升": 1}'::jsonb, ARRAY['可乐'], '包装饮料常见份量', '易拉罐/瓶装近似', 20),
  ('酸辣粉', '酸辣粉', 420, '{"碗": 420, "份": 420}'::jsonb, ARRAY['酸辣粉'], '中国食物成分表常见份量', '夜宵单碗', 20),
  ('火腿蛋炒饭', '火腿蛋炒饭', 400, '{"盘": 400, "份": 400}'::jsonb, ARRAY['火腿蛋炒饭'], '家常成品常见份量', '单盘成品', 5),
  ('排骨粥', '排骨粥', 350, '{"碗": 350, "份": 350}'::jsonb, ARRAY['排骨粥'], '中国食物成分表常见份量', '单碗成品', 20),
  ('牛肉面', '牛肉面', 430, '{"碗": 430, "份": 430}'::jsonb, ARRAY['牛肉面'], '中国食物成分表常见份量', '单碗成品', 15)
ON CONFLICT (normalized_name_zh) DO UPDATE
SET
  food_name_zh = EXCLUDED.food_name_zh,
  default_grams = EXCLUDED.default_grams,
  unit_grams = EXCLUDED.unit_grams,
  keyword_patterns = EXCLUDED.keyword_patterns,
  reference_source = EXCLUDED.reference_source,
  notes = EXCLUDED.notes,
  priority = EXCLUDED.priority,
  updated_at = NOW();

INSERT INTO core.canonical_food_alias (
  canonical_food_id,
  alias_text,
  normalized_alias,
  language_code,
  alias_type,
  provenance,
  confidence
)
SELECT
  ac.entity_id,
  seed.alias_text,
  regexp_replace(lower(seed.alias_text), '\s+', '', 'g'),
  'zh',
  'seeded_exact_alias',
  'fitness_food_seed',
  0.98
FROM (
  VALUES
    ('包子'),
    ('豆浆'),
    ('酸奶'),
    ('馒头'),
    ('宫保鸡丁')
) AS seed(alias_text)
JOIN core.app_catalog_profile_23 ac
  ON ac.entity_type = 'food'
 AND ac.publish_ready = TRUE
 AND ac.food_name_zh = seed.alias_text
WHERE NOT EXISTS (
  SELECT 1
  FROM core.canonical_food_alias existing
  WHERE existing.canonical_food_id = ac.entity_id
    AND existing.normalized_alias = regexp_replace(lower(seed.alias_text), '\s+', '', 'g')
    AND existing.language_code = 'zh'
    AND existing.provenance = 'fitness_food_seed'
);

INSERT INTO core.recipe_alias (
  recipe_id,
  alias_text,
  normalized_alias,
  language_code,
  alias_type,
  provenance,
  confidence
)
SELECT
  ac.entity_id,
  seed.alias_text,
  regexp_replace(lower(seed.alias_text), '\s+', '', 'g'),
  'zh',
  'seeded_recipe_alias',
  'fitness_food_seed',
  0.98
FROM (
  VALUES
    ('猪肉包子'),
    ('肉包子'),
    ('鲜肉包子')
) AS seed(alias_text)
JOIN core.app_catalog_profile_23 ac
  ON ac.entity_type = 'recipe'
 AND ac.publish_ready = TRUE
 AND ac.food_name_zh = '猪肉包子'
ON CONFLICT (recipe_id, normalized_alias, language_code, provenance) DO NOTHING;
