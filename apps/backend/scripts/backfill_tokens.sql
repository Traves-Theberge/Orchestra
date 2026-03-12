-- Backfill tokens from raw_payload where they were missed by the initial ingestion
UPDATE events
SET 
  input_tokens = COALESCE(
    NULLIF(CAST(json_extract(raw_payload, '$.tokens.input') AS INTEGER), 0),
    NULLIF(CAST(json_extract(raw_payload, '$.message.usage.input_tokens') AS INTEGER), 0),
    NULLIF(CAST(json_extract(raw_payload, '$.payload.info.last_token_usage.input_tokens') AS INTEGER), 0),
    0
  ),
  output_tokens = COALESCE(
    NULLIF(CAST(json_extract(raw_payload, '$.tokens.output') AS INTEGER), 0),
    NULLIF(CAST(json_extract(raw_payload, '$.message.usage.output_tokens') AS INTEGER), 0),
    NULLIF(CAST(json_extract(raw_payload, '$.payload.info.last_token_usage.output_tokens') AS INTEGER), 0),
    0
  )
WHERE (input_tokens = 0 AND output_tokens = 0) 
  AND raw_payload IS NOT NULL 
  AND json_valid(raw_payload)
  AND (
    raw_payload LIKE '%tokens%' OR 
    raw_payload LIKE '%usage%' OR 
    raw_payload LIKE '%total_token_usage%'
  );
