begin;
create table public.studio_chains (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 description text not null default '' check(length(description)<=1000), model_key text not null,
 created_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(), deleted_at timestamptz
);
create table public.studio_steps (
 id uuid primary key default gen_random_uuid(), chain_id uuid not null references public.studio_chains(id), position integer not null check(position>0),
 name text not null check(length(btrim(name)) between 1 and 120), instruction text not null check(length(btrim(instruction)) between 1 and 4000),
 input_mode text not null check(input_mode in ('original','previous')), deleted_at timestamptz
);
create unique index studio_step_position on public.studio_steps(chain_id,position) where deleted_at is null;
create table public.studio_runs (
 id uuid primary key default gen_random_uuid(), chain_id uuid not null references public.studio_chains(id), actor_id uuid not null references auth.users(id),
 chain_name text not null, model_key text not null, input_text text not null check(length(input_text)<=2000), image_path text,
 status text not null default 'pending' check(status in ('pending','running','succeeded','failed')), output_text text not null default '', error_message text,
 created_at timestamptz not null default now(), completed_at timestamptz
);
create index studio_runs_chain_date on public.studio_runs(chain_id,created_at desc);
create index studio_runs_actor_date on public.studio_runs(actor_id,created_at desc);
create table public.studio_run_steps (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.studio_runs(id), position integer not null,
 name text not null, instruction text not null, input_mode text not null, model_key text not null,
 status text not null default 'pending' check(status in ('pending','running','succeeded','failed')),
 prompt_text text not null default '', output_text text not null default '', error_message text, latency_ms integer, input_tokens integer, output_tokens integer,
 started_at timestamptz, completed_at timestamptz, unique(run_id,position)
);
do $$ declare t text; begin
 foreach t in array array['studio_chains','studio_steps','studio_runs','studio_run_steps'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy studio_admin_read on public.%I for select to authenticated using ((select private.is_superadmin()))',t);
 end loop;
end $$;
create function private.studio_save(cid uuid, version timestamptz, title text, summary text, model text, steps jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.studio_chains; item jsonb; sid uuid; pos integer:=0;
begin
 if not private.is_superadmin() then raise insufficient_privilege; end if;
 if title is null or length(btrim(title)) not between 1 and 120 or summary is null or length(summary)>1000
 or steps is null or jsonb_typeof(steps)<>'array' or jsonb_array_length(steps)>8 or length(steps::text)>40000 then raise exception 'Check the chain fields (maximum eight steps).'; end if;
 if not exists(select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.model_key=model and m.enabled and p.enabled and m.deleted_at is null and p.deleted_at is null and p.family='google') then raise exception 'Select an enabled Google model.'; end if;
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
create function private.studio_archive(cid uuid, version timestamptz, archived boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_superadmin() then raise insufficient_privilege; end if;
 update public.studio_chains set deleted_at=case when archived then clock_timestamp() else null end,updated_at=clock_timestamp() where id=cid and updated_at=version;
 if not found then raise exception 'Chain changed. Refresh before trying again.' using errcode='40001'; end if;
end $$;
create function private.studio_begin(cid uuid, version timestamptz, input text, image text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.studio_chains; rid uuid; n integer;
begin
 if not private.is_superadmin() then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text));
 select * into c from public.studio_chains where id=cid and deleted_at is null for share;
 if not found or c.updated_at is distinct from version then raise exception 'Save or refresh your chain before running it.'; end if;
 if input is null or length(input)>2000 or (length(btrim(input))=0 and image is null) then raise exception 'Add an image or describe a scene.'; end if;
 select count(*) into n from public.studio_steps where chain_id=cid and deleted_at is null;
 if n not between 1 and 8 then raise exception 'Add at least one step before running.'; end if;
 if not exists(select 1 from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.model_key=c.model_key and m.enabled and p.enabled and m.deleted_at is null and p.deleted_at is null and p.family='google') then raise exception 'This model is disabled. Select another model.'; end if;
 if image is not null and (image not like auth.uid()::text||'/%' or not exists(select 1 from storage.objects where bucket_id='prompt-studio' and name=image)) then raise exception 'Upload a valid source image.'; end if;
 if (select count(*) from public.studio_runs where actor_id=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'Hourly limit reached. Try again later.'; end if;
 if (select count(*) from public.studio_runs where actor_id=auth.uid() and status in ('pending','running') and created_at>now()-interval '10 minutes')>=2 then raise exception 'Finish your current runs first.'; end if;
 insert into public.studio_runs(chain_id,actor_id,chain_name,model_key,input_text,image_path) values(c.id,auth.uid(),c.name,c.model_key,btrim(input),image) returning id into rid;
 insert into public.studio_run_steps(run_id,position,name,instruction,input_mode,model_key) select rid,position,name,instruction,input_mode,c.model_key from public.studio_steps where chain_id=cid and deleted_at is null order by position;
 return rid;
end $$;
create function private.studio_claim(rid uuid, pos integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.studio_runs; s public.studio_run_steps; previous text;
begin
 if not private.is_superadmin() then raise insufficient_privilege; end if;
 select * into r from public.studio_runs where id=rid and actor_id=auth.uid() for update;
 if not found then raise exception 'Run unavailable.'; end if;
 select * into s from public.studio_run_steps where run_id=rid and position=pos for update;
 if not found then raise exception 'Step unavailable.'; end if;
 if s.status='succeeded' then return jsonb_build_object('done',true); end if;
 if r.status='failed' or s.status='failed' then raise exception 'This run failed. Start a new run.'; end if;
 if s.status='running' then
 if s.started_at>now()-interval '90 seconds' then raise exception 'This step is still running. Wait before resuming.'; end if;
 update public.studio_run_steps set status='failed',error_message='Execution interrupted. Start a new run.',completed_at=clock_timestamp() where id=s.id;
 update public.studio_runs set status='failed',error_message='Execution interrupted. Start a new run.',completed_at=clock_timestamp() where id=rid;
 return jsonb_build_object('interrupted',true);
 end if;
 if pos>1 then
 select output_text into previous from public.studio_run_steps where run_id=rid and position=pos-1 and status='succeeded';
 if not found then raise exception 'Run the previous step first.'; end if;
 end if;
 update public.studio_run_steps set status='running',started_at=clock_timestamp() where id=s.id;
 update public.studio_runs set status='running' where id=rid;
 return jsonb_build_object('run',to_jsonb(r),'step',to_jsonb(s),'previous',coalesce(previous,''));
end $$;
create function private.studio_finish(rid uuid,pos integer,result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare ok boolean:=coalesce((result->>'success')::boolean,false);
begin
 if not private.is_superadmin() then raise insufficient_privilege; end if;
 perform 1 from public.studio_runs where id=rid and actor_id=auth.uid() for update;
 if not found then raise exception 'Run unavailable.'; end if;
 update public.studio_run_steps set status=case when ok then 'succeeded' else 'failed' end,
 prompt_text=left(coalesce(result->>'prompt',''),16000),output_text=left(coalesce(result->>'output',''),12000),error_message=left(result->>'error',300),
 latency_ms=(result->>'latency')::integer,input_tokens=(result->>'input_tokens')::integer,output_tokens=(result->>'output_tokens')::integer,completed_at=clock_timestamp()
 where run_id=rid and position=pos and status='running';
 if not found then raise exception 'Step was not running.'; end if;
 if not ok then update public.studio_runs set status='failed',error_message=left(result->>'error',300),completed_at=clock_timestamp() where id=rid;
 elsif not exists(select 1 from public.studio_run_steps where run_id=rid and status<>'succeeded') then
 update public.studio_runs set status='succeeded',output_text=left(result->>'output',12000),completed_at=clock_timestamp() where id=rid;
 end if;
end $$;
-- Only invoker wrappers are exposed. Every private implementation checks the live Google superadmin role.
create function public.studio_save(cid uuid,version timestamptz,title text,summary text,model text,steps jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.studio_save(cid,version,title,summary,model,steps); $$;
create function public.studio_archive(cid uuid,version timestamptz,archived boolean) returns void language sql security invoker set search_path='' as $$ select private.studio_archive(cid,version,archived); $$;
create function public.studio_begin(cid uuid,version timestamptz,input text,image text) returns uuid language sql security invoker set search_path='' as $$ select private.studio_begin(cid,version,input,image); $$;
create function public.studio_claim(rid uuid,pos integer) returns jsonb language sql security invoker set search_path='' as $$ select private.studio_claim(rid,pos); $$;
create function public.studio_finish(rid uuid,pos integer,result jsonb) returns void language sql security invoker set search_path='' as $$ select private.studio_finish(rid,pos,result); $$;
do $$ declare sig text; begin foreach sig in array array['studio_save(uuid,timestamptz,text,text,text,jsonb)','studio_archive(uuid,timestamptz,boolean)','studio_begin(uuid,timestamptz,text,text)','studio_claim(uuid,integer)','studio_finish(uuid,integer,jsonb)'] loop
 execute 'revoke all on function public.'||sig||' from public,anon'; execute 'grant execute on function public.'||sig||' to authenticated';
 execute 'revoke all on function private.'||sig||' from public,anon'; execute 'grant execute on function private.'||sig||' to authenticated';
 end loop; end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('prompt-studio','prompt-studio',false,4194304,array['image/jpeg','image/png','image/webp']);
create policy studio_image_read on storage.objects for select to authenticated using(bucket_id='prompt-studio' and (select private.is_superadmin()));
create policy studio_image_insert on storage.objects for insert to authenticated with check(bucket_id='prompt-studio' and (select private.is_superadmin()) and (storage.foldername(name))[1]=(select auth.uid())::text);
-- A useful starter, with three real sequential calls rather than one concatenated prompt.
with c as (insert into public.studio_chains(name,description,model_key)
 select 'From scene to punchline','Describe what is visible, find the funny angle, then craft five short captions.',m.model_key from public.llm_models m join public.llm_providers p on p.id=m.provider_id where m.enabled and p.enabled and m.deleted_at is null and p.deleted_at is null and p.family='google' order by m.priority limit 1 returning id)
insert into public.studio_steps(chain_id,position,name,instruction,input_mode)
select c.id,v.* from c cross join (values
 (1,'Read the image','Describe the visible image or supplied scene in two sentences. Ground every detail in the source. Do not identify real people or infer sensitive traits.','original'),
 (2,'Find the funny angle','Use the description to find one playful, specific observation a college student would relate to. Keep it kind and grounded in the original scene.','previous'),
 (3,'Craft five captions','Using the funny angle, write five short, distinct captions. One caption per line, numbered 1–5. Keep each under 180 characters and related to the source.','previous')) v;
commit;
