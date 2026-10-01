-- Move the existing Dr/Md title prefixes out of names once. Future profiles
-- supply these fields explicitly; names are never stripped during editing.
UPDATE canonical_speaker_content
   SET content_json = json_set(
         content_json,
         '$.profile.honorific', substr(json_extract(content_json, '$.profile.name'), 1, instr(json_extract(content_json, '$.profile.name'), ' ') - 1),
         '$.profile.name', trim(substr(json_extract(content_json, '$.profile.name'), instr(json_extract(content_json, '$.profile.name'), ' ') + 1))
       ),
       content_version = content_version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_by = 'migration-0021'
 WHERE COALESCE(json_extract(content_json, '$.profile.honorific'), '') = ''
   AND lower(substr(json_extract(content_json, '$.profile.name'), 1, instr(json_extract(content_json, '$.profile.name'), ' ') - 1)) IN ('dr', 'dr.', 'md', 'md.', 'm.d.')
   AND length(trim(substr(json_extract(content_json, '$.profile.name'), instr(json_extract(content_json, '$.profile.name'), ' ') + 1))) >= 2;

-- Preserve MD titles already written after a name as a separate suffix.
UPDATE canonical_speaker_content
   SET content_json = json_set(
         content_json,
         '$.profile.credentials', trim(substr(json_extract(content_json, '$.profile.name'), -CASE WHEN lower(substr(json_extract(content_json, '$.profile.name'), -4)) = ' md.' THEN 3 ELSE 2 END)),
         '$.profile.name', rtrim(substr(json_extract(content_json, '$.profile.name'), 1, length(json_extract(content_json, '$.profile.name')) - CASE WHEN lower(substr(json_extract(content_json, '$.profile.name'), -4)) = ' md.' THEN 4 ELSE 3 END), ' ,')
       ),
       content_version = content_version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       updated_by = 'migration-0021'
 WHERE COALESCE(json_extract(content_json, '$.profile.credentials'), '') = ''
   AND (lower(substr(json_extract(content_json, '$.profile.name'), -3)) = ' md' OR lower(substr(json_extract(content_json, '$.profile.name'), -4)) = ' md.')
   AND length(rtrim(substr(json_extract(content_json, '$.profile.name'), 1, length(json_extract(content_json, '$.profile.name')) - CASE WHEN lower(substr(json_extract(content_json, '$.profile.name'), -4)) = ' md.' THEN 4 ELSE 3 END), ' ,')) >= 2;
