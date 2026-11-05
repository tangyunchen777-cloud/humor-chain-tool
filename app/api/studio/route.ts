import { requireAdmin } from '@/lib/admin';
import { loadStudio } from '@/lib/studio';
import { buildPrompt,generateStep } from '@/lib/engine';
export const maxDuration=60;
export async function GET(request:Request){return Response.json(await loadStudio(new URL(request.url).searchParams.get('chain')),{headers:{'Cache-Control':'private, no-store'}});}
export async function POST(request:Request){
 const {supabase}=await requireAdmin();
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
 if(Number(request.headers.get('content-length')||0)>5*1024*1024)return Response.json({error:'The upload is too large (maximum 4 MB image).'}, {status:413});
 try{
 const form=await request.formData();const op=form.get('op');let data:unknown;let error:{message:string}|null=null;
 const json=()=>JSON.parse(String(form.get('payload')||'{}'));
 if(op==='save'){({data,error}=await supabase.rpc('studio_save',json()));}
 else if(op==='archive'){({data,error}=await supabase.rpc('studio_archive',json()));}
 else if(op==='begin'){
 const p=json();let image:string|null=null;const file=form.get('image');
 if(file instanceof File&&file.size){
 if(file.size>4*1024*1024)throw new Error('Choose an image under 4 MB.');
 const bytes=Buffer.from(await file.arrayBuffer());
 const mime=bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!mime)throw new Error('Choose a valid JPG, PNG or WebP image.');
 const {user}=await requireAdmin();image=`${user.id}/${crypto.randomUUID()}.${mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp'}`;
 const uploaded=await supabase.storage.from('prompt-studio').upload(image,bytes,{contentType:mime,upsert:false});
 if(uploaded.error)throw new Error('The image could not be uploaded. Please try again.');
 }
 ({data,error}=await supabase.rpc('studio_begin',{...p,image}));
 }else if(op==='step'){
 const p=json();const claimed=await supabase.rpc('studio_claim',{rid:p.rid,pos:p.pos});
 if(claimed.error)throw new Error(claimed.error.message);
 if(claimed.data.done)return Response.json({data:{done:true}});
 if(claimed.data.interrupted)throw new Error('Execution was interrupted. Start a new run.');
 const {run,step,previous}=claimed.data;let image;let result;
 const prompt=buildPrompt(step.instruction,run.input_text,previous,step.input_mode);
 try{
 if(run.image_path){const download=await supabase.storage.from('prompt-studio').download(run.image_path);if(download.error||!download.data)throw new Error('Source image could not load.');image={mimeType:download.data.type,base64:Buffer.from(await download.data.arrayBuffer()).toString('base64')};}
 result=await generateStep(step.model_key,prompt,image);
 }catch(e){result={success:false,prompt,output:'',error:e instanceof Error?e.message:'Step failed.',latency:0};}
 const finished=await supabase.rpc('studio_finish',{rid:p.rid,pos:p.pos,result});if(finished.error)throw new Error('The result could not be saved. Reload the run before continuing.');
 data=result;if(!result.success)return Response.json({error:result.error},{status:422});
 }else return Response.json({error:'Unknown operation.'},{status:400});
 if(error)throw new Error(error.message);return Response.json({data});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Please try again.'},{status:400});}
}
