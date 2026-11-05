begin;
insert into public.llm_providers(name,family,notes) select 'OpenAI','other','Responses API for the Week 8 chain tool; public caption app stays on Google.' where not exists(select 1 from public.llm_providers where name='OpenAI' and deleted_at is null);
insert into public.llm_models(provider_id,name,model_key,priority) select id,'OpenAI · GPT-4.1 mini','gpt-4.1-mini',0 from public.llm_providers where name='OpenAI' and deleted_at is null and not exists(select 1 from public.llm_models where model_key='gpt-4.1-mini' and deleted_at is null) limit 1;
create or replace function private.studio_save(cid uuid, version timestamptz, title text, summary text, model text, steps jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.studio_chains; item jsonb; sid uuid; pos integer:=0;
begin
 if not private.is_superadmin() then raise insufficient_privilege; end if;
 if title is null or length(btrim(title)) not between 1 and 120 or summary is null or length(summary)>1000
 or steps is null or jsonb_typeof(steps)<>'array' or jsonb_array_length(steps)>8 or length(steps::text)>40000 then raise exception 'Check the chain fields (maximum eight steps).'; end if;
 if not exists(select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.model_key=model and m.enabled and p.enabled and m.deleted_at is null and p.deleted_at is null and (p.family='google' or (p.name='OpenAI' and m.model_key='gpt-4.1-mini'))) then raise exception 'Select an enabled supported model.'; end if;
 if cid is null then
 insert into public.studio_chains(name,description,model_key,created_by) values(btrim(title),btrim(summary),model,auth.uid()) returning * into c;
 else
 select * into c from public.studio_chains where id=cid and deleted_at is null for update;
 if not found then raise exception 'Chain unavailable.'; end if;
 if c.updated_at is distinct from version then raise exception 'This chain changed. Refresh before saving.' using errcode='40001'; end if;
 end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(steps) x where x->>'id' is not null)<>(select count(*) from jsonb_array_elements(steps) x where x->>'id' is not null) then raise exception 'Duplicate step IDs.'; end if;
 for item in select * from jsonb_array_elements(steps) loop
 if jsonb_typeof(item->'name') is distinct from 'string' or length(btrim(item->>'name')) not between 1 and 120
 or jsonb_typeof(item->'instruction') is distinct from 'string' or length(btrim(item->>'instruction')) not between 1 and 4000
 or coalesce(item->>'input_mode','') not in ('original','previous') then raise exception 'Check every step name, instruction and input.'; end if;
 if item->>'id' is not null and not exists(select 1 from public.studio_steps where id=(item->>'id')::uuid and chain_id=c.id and deleted_at is null) then raise exception 'Step does not belong to this chain.'; end if;
 end loop;
 update public.studio_steps set deleted_at=clock_timestamp() where chain_id=c.id and deleted_at is null;
 for item in select * from jsonb_array_elements(steps) loop
 pos:=pos+1;
 if item->>'id' is null then
 insert into public.studio_steps(chain_id,position,name,instruction,input_mode) values(c.id,pos,btrim(item->>'name'),btrim(item->>'instruction'),item->>'input_mode');
 else
 update public.studio_steps set position=pos,name=btrim(item->>'name'),instruction=btrim(item->>'instruction'),input_mode=item->>'input_mode',deleted_at=null where id=(item->>'id')::uuid;
 end if;
 end loop;
 update public.studio_chains set name=btrim(title),description=btrim(summary),model_key=model,updated_at=clock_timestamp() where id=c.id;
 return c.id;
end $$;
create or replace function private.studio_begin(cid uuid, version timestamptz, input text, image text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.studio_chains; rid uuid; n integer;
begin
 if not private.is_superadmin() then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into c from public.studio_chains where id=cid and deleted_at is null for share;
 if not found or c.updated_at is distinct from version then raise exception 'Save or refresh your chain before running it.'; end if;
 if input is null or length(input)>2000 or (length(btrim(input))=0 and image is null) then raise exception 'Add an image or describe a scene.'; end if;
 select count(*) into n from public.studio_steps where chain_id=cid and deleted_at is null;
 if n not between 1 and 8 then raise exception 'Add at least one step before running.'; end if;
 if not exists(select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.model_key=c.model_key and m.enabled and p.enabled and m.deleted_at is null and p.deleted_at is null and (p.family='google' or (p.name='OpenAI' and m.model_key='gpt-4.1-mini'))) then raise exception 'This model is disabled. Select another model.'; end if;
 if image is not null and (image not like auth.uid()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='prompt-studio' and name=image)) then raise exception 'Upload a valid source image.'; end if;
 if (select count(*) from public.studio_runs where actor_id=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'Hourly limit reached. Try again later.'; end if;
 if (select count(*) from public.studio_runs where actor_id=auth.uid() and status in ('pending','running') and created_at>now()-interval '10 minutes')>=2 then raise exception 'Finish your current runs first.'; end if;
 insert into public.studio_runs(chain_id,actor_id,chain_name,model_key,input_text,image_path) values(c.id,auth.uid(),c.name,c.model_key,btrim(input),image) returning id into rid;
 insert into public.studio_run_steps(run_id,position,name,instruction,input_mode,model_key) select rid,position,name,instruction,input_mode,c.model_key from public.studio_steps where chain_id=cid and deleted_at is null order by position;
 return rid;
end $$;
update public.studio_chains set model_key='gpt-4.1-mini',updated_at=clock_timestamp() where (name='From scene to punchline' and created_by is null) or (name='Campus quick take' and model_key like 'gemini%');
commit;
