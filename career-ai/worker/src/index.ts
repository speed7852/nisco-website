export interface Env { APP_NAME:string; APP_ACCESS_KEY?:string; DB:D1Database; PRIVATE_FILES:R2Bucket; AI:Ai }
const cors=(origin:string|null)=>{const allowed=!!origin&&(/^https:\/\/[a-z0-9-]+\.nisco-career-ai\.pages\.dev$/.test(origin)||origin==="https://nisco-career-ai.pages.dev");return {"access-control-allow-origin":allowed?origin!:"null","access-control-allow-methods":"GET,POST,PUT,OPTIONS","access-control-allow-headers":"authorization,content-type","access-control-max-age":"86400","vary":"Origin"}};
const out=(v:unknown,s=200,h:Record<string,string>={})=>Response.json(v,{status:s,headers:{"cache-control":"no-store","x-content-type-options":"nosniff",...h}});
async function runAI(env:Env,prompt:string){return env.AI.run("@cf/meta/llama-3.1-8b-instruct",{messages:[{role:"system",content:"You are NISCO Career AI. Use only supplied facts. Never invent experience, qualifications, dates or metrics. Never submit applications. Return clear structured output."},{role:"user",content:prompt}]});}
export default {
 async fetch(req:Request,env:Env){
  const u=new URL(req.url),origin=req.headers.get("origin"),ch=cors(origin);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:ch});
  if(u.pathname==="/health")return out({ok:true,service:env.APP_NAME,phase:"career-ai-api",authConfigured:!!env.APP_ACCESS_KEY},200,ch);
  if(!env.APP_ACCESS_KEY)return out({error:"setup_required",message:"Configure APP_ACCESS_KEY Worker secret."},503,ch);
  if(req.headers.get("authorization")!==`Bearer ${env.APP_ACCESS_KEY}`)return out({error:"unauthorized"},401,ch);
  try{
   if(u.pathname==="/api/profile"&&req.method==="GET"){const r=await env.DB.prepare("SELECT data,updated_at FROM profile WHERE id=1").first<any>();return out({profile:r?JSON.parse(r.data):null,updatedAt:r?.updated_at??null},200,ch);}
   if(u.pathname==="/api/profile"&&req.method==="PUT"){const d=await req.json(),now=new Date().toISOString();await env.DB.prepare("INSERT INTO profile(id,data,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(JSON.stringify(d),now).run();return out({ok:true,updatedAt:now},200,ch);}
   if(u.pathname==="/api/jobs"&&req.method==="GET"){const r=await env.DB.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200").all();return out({jobs:r.results},200,ch);}
   if(u.pathname==="/api/jobs"&&req.method==="POST"){const j=await req.json() as any;if(!j.title||!j.company||!j.description)return out({error:"title, company and description required"},400,ch);const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO jobs(id,title,company,location,url,description,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,j.title,j.company,j.location??"",j.url??"",j.description,new Date().toISOString()).run();return out({ok:true,id},201,ch);}
   if(u.pathname==="/api/jobs/match"&&req.method==="POST"){const {jobId}=await req.json() as any;const [j,p]=await Promise.all([env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<any>(),env.DB.prepare("SELECT data FROM profile WHERE id=1").first<any>()]);if(!j||!p)return out({error:"Save your profile and job first"},400,ch);const a=await runAI(env,"Assess fit from 0-100. Return JSON only: {score,matched,gaps,rationale}. Score conservatively; do not infer missing facts. Candidate: "+p.data+" Job: "+JSON.stringify(j));const raw=(a as any).response??JSON.stringify(a);let parsed:any;try{parsed=JSON.parse(raw.replace(/^```json\s*/,"").replace(/```$/,""));}catch{parsed={score:0,matched:[],gaps:["AI response needs review"],rationale:raw};}if(Number.isFinite(Number(parsed.score)))await env.DB.prepare("UPDATE jobs SET match_score=? WHERE id=?").bind(Number(parsed.score),jobId).run();return out({assessment:parsed,shortlisted:Number(parsed.score)>=80},200,ch);}
   if(u.pathname==="/api/applications"&&req.method==="GET"){const r=await env.DB.prepare("SELECT a.*,j.title,j.company,j.url FROM applications a JOIN jobs j ON j.id=a.job_id ORDER BY a.updated_at DESC").all();return out({applications:r.results},200,ch);}
   if(u.pathname==="/api/applications"&&req.method==="POST"){const a=await req.json() as any;if(!a.jobId)return out({error:"jobId required"},400,ch);const id=crypto.randomUUID();await env.DB.prepare("INSERT INTO applications(id,job_id,status,notes,updated_at) VALUES(?,?,?,?,?)").bind(id,a.jobId,a.status??"prepared",a.notes??"",new Date().toISOString()).run();return out({ok:true,id},201,ch);}
   if(u.pathname.startsWith("/api/applications/")&&req.method==="PUT"){const id=u.pathname.split("/").pop(),a=await req.json() as any;await env.DB.prepare("UPDATE applications SET status=?,notes=?,updated_at=? WHERE id=?").bind(a.status??"prepared",a.notes??"",new Date().toISOString(),id).run();return out({ok:true},200,ch);}
   if(u.pathname==="/api/ai/draft"&&req.method==="POST"){const b=await req.json() as any;if(!b.profile||!b.job||!b.task)return out({error:"task, profile and job required"},400,ch);const a=await runAI(env,"Create a truthful "+b.task+" for this job. Candidate facts: "+JSON.stringify(b.profile)+". Job: "+JSON.stringify(b.job)+". Flag unknown details; do not fabricate.");return out({draft:(a as any).response??a,approvalRequired:true},200,ch);}
   if(u.pathname==="/api/files"&&req.method==="POST"){const key="private/"+crypto.randomUUID(),name=req.headers.get("x-file-name")??"career-document";await env.PRIVATE_FILES.put(key,req.body,{httpMetadata:{contentType:req.headers.get("content-type")??"application/octet-stream"},customMetadata:{originalName:name}});return out({ok:true,key,name},201,ch);}
   return out({error:"not_found"},404,ch);
  }catch(e){console.error(e);return out({error:"internal_error"},500,ch);}
 },
 async scheduled(c:ScheduledController,env:Env){
  console.log("Career AI discovery started",c.cron,new Date(c.scheduledTime).toISOString());
  const roleTerms=["pmo","program manager","project manager","service delivery","it operations","transformation manager","delivery manager","portfolio manager"];
  const placeTerms=["saudi","riyadh","jeddah","madinah","medina","india","chennai","bengaluru","bangalore","hyderabad","gurgaon","gurugram","remote","worldwide","anywhere","emea"];
  const feeds=[{name:"Arbeitnow",url:"https://www.arbeitnow.com/api/job-board-api?page=1"},{name:"Remote OK",url:"https://remoteok.com/api"}];
  let inserted=0,checked=0;
  for(const feed of feeds){
   try{
    const response=await fetch(feed.url,{headers:{"accept":"application/json","user-agent":"NISCO-Career-AI/1.0 personal job discovery"}});
    if(!response.ok)throw new Error("HTTP "+response.status);
    const payload:any=await response.json();
    const rows:any[]=Array.isArray(payload)?payload:(payload.data||payload.jobs||[]);
    for(const item of rows){
     if(!item||typeof item!=="object")continue;
     const title=String(item.title||item.position||"");
     const company=String(item.company_name||item.company||"Unknown company");
     const location=String(item.location||item.candidate_required_location||"Remote");
     const url=String(item.url||item.apply_url||"");
     const description=String(item.description||item.tags?.join(", ")||title);
     const remote=!!(item.remote||item.isRemote||/remote|worldwide|anywhere/i.test(location));
     const t=title.toLowerCase(),l=location.toLowerCase();
     if(!title||!url.startsWith("https://")||!roleTerms.some(k=>t.includes(k))||!(remote||placeTerms.some(k=>l.includes(k))))continue;
     checked++;
     const exists=await env.DB.prepare("SELECT id FROM jobs WHERE url=? LIMIT 1").bind(url).first();
     if(exists)continue;
     await env.DB.prepare("INSERT INTO jobs(id,title,company,location,url,description,created_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),title,company,location,url,description+"\n\nSource: "+feed.name+" · Open original listing for details.",new Date().toISOString()).run();
     inserted++;
    }
   }catch(e){console.error("Job feed failed",feed.name,String(e));}
  }
  console.log("Career AI discovery complete",{inserted,checked});
 }
};