CREATE TABLE IF NOT EXISTS projects (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'))
);

CREATE TABLE IF NOT EXISTS jingshan_workspace (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    published jsonb NOT NULL,
    draft jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1,
    revision integer NOT NULL DEFAULT 1,
    published_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jingshan_publications (
    version integer PRIMARY KEY,
    data jsonb NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE jingshan_workspace ADD COLUMN IF NOT EXISTS demo_results_seeded boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS jingshan_results (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scene text NOT NULL,
    title text NOT NULL,
    department text NOT NULL,
    summary text NOT NULL,
    features jsonb NOT NULL,
    version integer NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'completed')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jingshan_cim_services (
    id text PRIMARY KEY,
    name text NOT NULL,
    category text NOT NULL,
    kind text NOT NULL,
    url text NOT NULL,
    layer text NOT NULL DEFAULT '',
    version text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    default_visible boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    source_sheet text,
    source_row integer,
    revision integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'unchecked',
    status_message text NOT NULL DEFAULT '',
    checked_at timestamptz,
    deleted boolean NOT NULL DEFAULT false
);

ALTER TABLE jingshan_cim_services ADD COLUMN IF NOT EXISTS raster jsonb;
DO $migration$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'jingshan_cim_services'::regclass AND conname = 'cim_service_protocol_v2') THEN
        ALTER TABLE jingshan_cim_services DROP CONSTRAINT IF EXISTS jingshan_cim_services_kind_check;
        ALTER TABLE jingshan_cim_services DROP CONSTRAINT IF EXISTS cim_service_protocol;
        ALTER TABLE jingshan_cim_services ADD CONSTRAINT cim_service_protocol_v2 CHECK (kind IN ('wms','wfs','geojson','arcgis','xyz','wmts','3dtiles'));
    END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS jingshan_venue_opening_tasks (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id uuid NOT NULL UNIQUE,
    venue_id text NOT NULL,
    venue_name text NOT NULL,
    region text NOT NULL DEFAULT '',
    mode text NOT NULL CHECK (mode IN ('live','demo')),
    department text NOT NULL,
    due date NOT NULL,
    stage text NOT NULL CONSTRAINT jingshan_opening_stage_v2 CHECK (stage IN ('assigned','received','review','closed','withdrawn')),
    history jsonb NOT NULL
);
DO $migration$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='jingshan_venue_opening_tasks'::regclass AND conname='jingshan_venue_opening_tasks_stage_check') THEN
        ALTER TABLE jingshan_venue_opening_tasks DROP CONSTRAINT jingshan_venue_opening_tasks_stage_check,
            ADD CONSTRAINT jingshan_opening_stage_v2 CHECK (stage IN ('assigned','received','review','closed','withdrawn'));
    END IF;
END
$migration$;
CREATE UNIQUE INDEX IF NOT EXISTS jingshan_opening_active_v2
    ON jingshan_venue_opening_tasks (mode, venue_id) WHERE stage IN ('assigned','received','review');
DROP INDEX IF EXISTS jingshan_venue_opening_one_active;
CREATE INDEX IF NOT EXISTS jingshan_venue_opening_history
    ON jingshan_venue_opening_tasks (mode, venue_id, seq DESC);
CREATE TABLE IF NOT EXISTS jingshan_opening_schedules (
    task_id uuid PRIMARY KEY REFERENCES jingshan_venue_opening_tasks(id),
    venue_id text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('demo','live')),
    plan jsonb NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    cancelled boolean NOT NULL DEFAULT false
);
ALTER TABLE jingshan_venue_opening_tasks ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT '';
UPDATE jingshan_venue_opening_tasks AS task SET region = COALESCE((
    SELECT f->'properties'->>'region'
    FROM jingshan_publications p
    CROSS JOIN LATERAL jsonb_array_elements(p.data->'datasets') d
    CROSS JOIN LATERAL jsonb_array_elements(d->'features') f
    WHERE p.data->>'mode' = task.mode AND d->>'id' IN ('venues','courts')
      AND CASE WHEN d->>'id' = 'venues' THEN f->>'id' ELSE COALESCE(NULLIF(f->'properties'->>'facilityId',''),f->>'id') END = task.venue_id
    ORDER BY p.version DESC, (d->>'id' = 'venues') DESC LIMIT 1
),'') WHERE task.region = '';

CREATE TABLE IF NOT EXISTS jingshan_activity (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    area text NOT NULL,
    action text NOT NULL,
    resource text NOT NULL,
    detail text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS jingshan_activity_publication
    ON jingshan_activity(resource) WHERE area = '发布管理' AND action = '发布版本';

INSERT INTO jingshan_activity(recorded_at,area,action,resource,detail)
SELECT published_at,'发布管理','发布版本','V' || version,jsonb_array_length(data->'datasets') || ' 个数据集'
FROM jingshan_publications p WHERE NOT EXISTS (
    SELECT FROM jingshan_activity a WHERE a.area='发布管理' AND a.action='发布版本' AND a.resource='V' || p.version
) ORDER BY version ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION jingshan_log_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO jingshan_activity(recorded_at,area,action,resource,detail)
    VALUES (NEW.published_at,'发布管理','发布版本','V' || NEW.version,jsonb_array_length(NEW.data->'datasets') || ' 个数据集');
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER jingshan_publication_activity AFTER INSERT ON jingshan_publications
FOR EACH ROW EXECUTE FUNCTION jingshan_log_publication();

CREATE OR REPLACE FUNCTION jingshan_log_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    entry record;
    counts record;
BEGIN
    IF NEW.draft IS DISTINCT FROM OLD.draft THEN
        FOR entry IN
            SELECT old_item, new_item FROM jsonb_array_elements(OLD.draft->'datasets') old_item
            FULL JOIN jsonb_array_elements(NEW.draft->'datasets') new_item ON old_item->>'id' = new_item->>'id'
            WHERE old_item IS DISTINCT FROM new_item
        LOOP
            SELECT count(*) FILTER (WHERE a IS NULL) AS added,
                   count(*) FILTER (WHERE b IS NULL) AS removed,
                   count(*) FILTER (WHERE a IS NOT NULL AND b IS NOT NULL AND a <> b) AS edited
            INTO counts
            FROM jsonb_array_elements(entry.old_item->'features') a
            FULL JOIN jsonb_array_elements(entry.new_item->'features') b ON a->>'id' = b->>'id';
            INSERT INTO jingshan_activity(area,action,resource,detail)
            VALUES ('数据草稿',CASE WHEN entry.old_item IS NULL THEN '新增数据集' WHEN entry.new_item IS NULL THEN '移除数据集' ELSE '修改数据集' END,
                COALESCE(entry.new_item->>'name',entry.old_item->>'name'),
                'R' || NEW.revision || ' · ' || CASE WHEN counts.added + counts.removed + counts.edited = 0 THEN '数据集配置或顺序调整' ELSE
                  '新增 ' || counts.added || '、修改 ' || counts.edited || '、移除 ' || counts.removed || ' 条' END);
        END LOOP;
        IF (NEW.draft - 'datasets') IS DISTINCT FROM (OLD.draft - 'datasets') THEN
            INSERT INTO jingshan_activity(area,action,resource,detail)
            VALUES ('数据草稿','修改配置','分析参数或地图设置','R' || NEW.revision);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER jingshan_workspace_activity AFTER UPDATE OF draft ON jingshan_workspace
FOR EACH ROW EXECUTE FUNCTION jingshan_log_workspace();

CREATE OR REPLACE FUNCTION jingshan_log_operation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    area_label text;
    action_label text;
    resource_label text;
    detail_label text;
BEGIN
    IF TG_TABLE_NAME = 'jingshan_cim_services' THEN
        area_label := '地图服务';
        resource_label := NEW.name;
        detail_label := upper(NEW.kind) || ' · ' || NEW.category;
        IF TG_OP = 'INSERT' THEN action_label := '接入服务';
        ELSIF OLD.deleted IS DISTINCT FROM NEW.deleted AND NEW.deleted THEN action_label := '移除服务';
        ELSIF OLD.enabled IS DISTINCT FROM NEW.enabled THEN action_label := CASE WHEN NEW.enabled THEN '启用服务' ELSE '停用服务' END;
        ELSIF OLD.revision <> NEW.revision THEN action_label := '修改服务';
        ELSIF OLD.status IS DISTINCT FROM NEW.status THEN action_label := '更新连接状态';
        ELSE RETURN NEW;
        END IF;
    ELSIF TG_TABLE_NAME = 'jingshan_results' THEN
        area_label := '成果台账';
        resource_label := NEW.title;
        detail_label := NEW.department;
        action_label := CASE WHEN TG_OP = 'INSERT' THEN '登记成果' WHEN NEW.status = 'received' THEN '接收成果' ELSE '完成回流' END;
    ELSE
        area_label := '场地交办';
        resource_label := NEW.venue_name;
        detail_label := NEW.department;
        action_label := CASE NEW.history->-1->>'action'
            WHEN 'assign' THEN '发起交办' WHEN 'receive' THEN '签收任务' WHEN 'return' THEN '退回补充'
            WHEN 'feedback' THEN '提交反馈' WHEN 'close' THEN '核验办结' WHEN 'withdraw' THEN '撤回交办'
            WHEN 'remind' THEN '登记督办' ELSE '更新工单' END;
    END IF;
    INSERT INTO jingshan_activity(area,action,resource,detail) VALUES (area_label,action_label,resource_label,detail_label);
    RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER jingshan_service_activity AFTER INSERT OR UPDATE ON jingshan_cim_services
FOR EACH ROW EXECUTE FUNCTION jingshan_log_operation();
CREATE OR REPLACE TRIGGER jingshan_result_activity AFTER INSERT OR UPDATE OF status ON jingshan_results
FOR EACH ROW EXECUTE FUNCTION jingshan_log_operation();
CREATE OR REPLACE TRIGGER jingshan_opening_activity AFTER INSERT OR UPDATE OF history ON jingshan_venue_opening_tasks
FOR EACH ROW EXECUTE FUNCTION jingshan_log_operation();

CREATE TABLE IF NOT EXISTS jingshan_platform_users (
  name text PRIMARY KEY, digest text NOT NULL, department text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('admin','editor','reviewer','viewer')), enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS jingshan_platform_reviews (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, revision integer NOT NULL, note text NOT NULL,
  applicant text NOT NULL, created timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected')),
  reviewer text, opinion text, finished timestamptz, version integer
);
CREATE UNIQUE INDEX IF NOT EXISTS jingshan_pending_revision ON jingshan_platform_reviews(revision) WHERE state='pending';
