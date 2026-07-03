-- `name` is a PostgreSQL built-in type; avoid it as RETURNS TABLE column label.

DROP FUNCTION IF EXISTS resolve_user_api_key(text);

CREATE OR REPLACE FUNCTION resolve_user_api_key(p_key_hash text)
RETURNS TABLE(id uuid, user_id text, key_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT uak.id, uak.user_id, uak.name AS key_name
  FROM user_api_key uak
  WHERE uak.key_hash = p_key_hash AND uak.is_active = true
  LIMIT 1;
$$;
