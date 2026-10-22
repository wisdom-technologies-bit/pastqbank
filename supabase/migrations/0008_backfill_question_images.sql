-- Prompt B3g: backfill normalized image URLs from the ALOC payload.
update public.questions
set image_url = case
  when v.value ~* '^https?://' then regexp_replace(v.value, '^http:', 'https:')
  when v.value ~ '^/' then 'https://res.cloudinary.com/aloc-ng' || v.value
  else null
end
from (select id, lower(btrim(raw_payload->>'imageUrl')) as value from public.questions) v
where public.questions.id = v.id
  and v.value not in ('', 'null', 'none', 'n/a')
  and (v.value ~* '^https?://' or v.value ~ '^/');
