import { requireAdmin } from './admin';
export type Step={id?:string;chain_id?:string;position:number;name:string;instruction:string;input_mode:'original'|'previous'};
export type Chain={id:string;name:string;description:string;model_key:string;updated_at:string;deleted_at:string|null};
export type Run={id:string;chain_id:string;chain_name:string;model_key:string;input_text:string;image_path:string|null;image_url?:string;status:string;output_text:string;error_message:string|null;created_at:string};
export type RunStep={id:string;run_id:string;position:number;name:string;instruction:string;input_mode:string;model_key:string;status:string;prompt_text:string;output_text:string;error_message:string|null;latency_ms:number|null};
export type Data={chains:Chain[];steps:Step[];models:{name:string;model_key:string}[];runs:Run[];runSteps:RunStep[];selected:string|null};
export async function loadStudio(selected?:string|null):Promise<Data>{
 const {supabase}=await requireAdmin();
 const [{data:chains,error:c},{data:steps,error:s},{data:models,error:m}]=await Promise.all([
 supabase.from('studio_chains').select('*').order('created_at').limit(200),
 supabase.from('studio_steps').select('*').is('deleted_at',null).order('position').limit(1600),
 supabase.from('llm_models').select('name,model_key,llm_providers!inner(family,enabled,deleted_at)').eq('enabled',true).is('deleted_at',null).eq('llm_providers.family','google').eq('llm_providers.enabled',true).is('llm_providers.deleted_at',null).order('priority')]);
 if(c||s||m)throw new Error('The workspace could not load. Please try again.');
 const id=selected??chains?.find(x=>!x.deleted_at)?.id??null;
 const {data:runs,error:r}=id?await supabase.from('studio_runs').select('*').eq('chain_id',id).order('created_at',{ascending:false}).limit(25):{data:[],error:null};
 if(r)throw new Error('Run history could not load.');
 const {data:runSteps,error:rs}=runs?.length?await supabase.from('studio_run_steps').select('*').in('run_id',runs.map(r=>r.id)).order('position'):{data:[],error:null};
 if(rs)throw new Error('Step history could not load.');
 const hydrated=await Promise.all((runs??[]).map(async run=>({...run,image_url:run.image_path?(await supabase.storage.from('prompt-studio').createSignedUrl(run.image_path,3600)).data?.signedUrl:undefined})));
 return {chains:chains??[],steps:steps??[],models:models??[],runs:hydrated,runSteps:runSteps??[],selected:id};
}
