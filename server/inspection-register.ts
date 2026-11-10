import {z} from "zod";
import type {Db} from "./db.js";
import {HttpError} from "./site-operations.js";
import {date} from "./validation.js";
import {taskRecord,taskChain,type InspectionTaskRow} from "./inspection-schedule-model.js";
import {inspectionUse} from "./inspection-use.js";
import {getTemplate,type TemplateRow,type InspectionRow,inspectionRecord} from "./inspection-model.js";
const page={offset:z.coerce.number().int().min(0).max(1000000).default(0),keyword:z.string().trim().max(200).default("")};
export const taskRegisterQuery=z.object({...page,asOfDate:date,from:date.optional(),to:date.optional(),assigneeId:z.uuid().optional(),stage:z.enum(["all","planned","draft","submitted","accepted","cancelled","unknown"]).default("all"),work:z.enum(["all","my_start","my_drafts","my_submitted","reviewable"]).default("all"),due:z.enum(["all","elapsed","not_elapsed","unknown"]).default("all")}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:"예정일 범위를 확인하세요."});
export const templateRegisterQuery=z.object({...page,status:z.enum(["draft","published"]).optional(),use:z.enum(["all","available","stopped"]).default("all")}).strict();
export const inspectionRegisterQuery=z.object({...page,from:date.optional(),to:date.optional(),status:z.enum(["draft","submitted","accepted","returned"]).optional(),work:z.enum(["all","mine","reviewable"]).default("all"),history:z.enum(["all","current"]).default("current")}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:"기록일 범위를 확인하세요."});
function read<T>(db:Db,fn:()=>T){db.exec("BEGIN");try{const value=fn();db.exec("COMMIT");return value;}catch(e){db.exec("ROLLBACK");throw e;}}
export function inspectionTasksRegister(db:Db,site:string,user:string,role:string,q:z.infer<typeof taskRegisterQuery>){return read(db,()=>{
 const where=["site_id=?"],args:(string|number)[]=[site];
 if(q.from){where.push("json_extract(body,'$.plannedDate')>=?");args.push(q.from);}if(q.to){where.push("json_extract(body,'$.plannedDate')<=?");args.push(q.to);}if(q.assigneeId){where.push("assignee_id=?");args.push(q.assigneeId);}
 if(q.keyword){where.push("(instr(lower(json_extract(body,'$.location')),lower(?))>0 OR instr(lower(json_extract(body,'$.instructions')),lower(?))>0 OR instr(lower(json_extract(template_snapshot,'$.body.title')),lower(?))>0)");args.push(q.keyword,q.keyword,q.keyword);}
 const rows=db.prepare(`SELECT * FROM inspection_tasks WHERE ${where.join(" AND ")} ORDER BY updated_at DESC,id DESC LIMIT 1001`).all(...args) as InspectionTaskRow[];
 if(rows.length>1000)throw new HttpError(409,"일정 후보1000건 초과: 일부 합계를 만들지 않습니다. 예정일/담당자/문자 조건을 좁히세요.");
 const people=new Map<string,{name:string;eligible:boolean}>();
 const person=(id:string)=>{let found=people.get(id);if(!found){const r=db.prepare("SELECT u.name,m.role FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.site_id=? WHERE u.id=?").get(site,id) as {name:string;role:string|null}|undefined;found={name:r?.name||id,eligible:r?.role==="manager"||r?.role==="editor"};people.set(id,found);}return found;};
 const projected=rows.map(row=>{
  const record=taskRecord(row),chain=taskChain(db,row),latest=chain.latest;
  const stage=row.status==="cancelled"?"cancelled":row.status==="planned"?"planned":chain.hasMore||!latest||latest.status==="returned"?"unknown":latest.status;
  const elapsed=stage==="unknown"?null:!["accepted","cancelled"].includes(stage)&&record.body.plannedDate<q.asOfDate;
  const writable=role==="editor"||role==="manager";
  return {id:row.id,version:row.version,status:row.status,stage,plannedDate:record.body.plannedDate,location:record.body.location,title:record.template_snapshot.body.title,assigneeId:row.assignee_id,assigneeName:person(row.assignee_id).name,assigneeEligible:person(row.assignee_id).eligible,currentOwnerName:latest?person(latest.owner_id).name:null,currentOwnerEligible:latest?person(latest.owner_id).eligible:null,currentOwnerId:latest?.owner_id||null,inspectionId:latest?.id||null,chainIncomplete:chain.hasMore,elapsed,canStart:writable&&stage==="planned"&&row.assignee_id===user,canWrite:writable&&stage==="draft"&&latest?.owner_id===user,canReview:role==="manager"&&stage==="submitted"&&latest?.owner_id!==user,use:inspectionUse(db,getTemplate(db,site,row.template_id))};
 });
 const filtered=projected.filter(r=>(q.stage==="all"||q.stage===r.stage)&&(q.work==="all"||(q.work==="my_start"&&r.assigneeId===user&&r.stage==="planned")||(q.work==="my_drafts"&&r.currentOwnerId===user&&r.stage==="draft")||(q.work==="my_submitted"&&r.currentOwnerId===user&&r.stage==="submitted")||(q.work==="reviewable"&&r.canReview))&&(q.due==="all"||(q.due==="elapsed"&&r.elapsed===true)||(q.due==="not_elapsed"&&r.elapsed===false)||(q.due==="unknown"&&r.elapsed===null)));
 return {items:filtered.slice(q.offset,q.offset+50),total:filtered.length,hasMore:q.offset+50<filtered.length,asOfDate:q.asOfDate,candidateCount:rows.length};
});}
export function inspectionTemplatesRegister(db:Db,site:string,q:z.infer<typeof templateRegisterQuery>){return read(db,()=>{
 const where=["t.site_id=?"],args:(string|number)[]=[site];if(q.status){where.push("t.status=?");args.push(q.status);}if(q.keyword){where.push("(instr(lower(json_extract(t.body,'$.title')),lower(?))>0 OR instr(lower(json_extract(t.body,'$.instructions')),lower(?))>0 OR EXISTS(SELECT 1 FROM json_each(t.body,'$.items') i WHERE instr(lower(json_extract(i.value,'$.text')),lower(?))>0))");args.push(q.keyword,q.keyword,q.keyword);}if(q.use!=="all"){where.push("t.status='published'");where.push((q.use==="available"?"NOT ":"")+"EXISTS(SELECT 1 FROM inspection_template_use_stops x WHERE x.template_id=t.id)");}
 const sql=where.join(" AND "),total=Number(db.prepare(`SELECT COUNT(*) n FROM inspection_templates t WHERE ${sql}`).get(...args)?.n),rows=db.prepare(`SELECT t.* FROM inspection_templates t WHERE ${sql} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`).all(...args,q.offset) as TemplateRow[];
 return {items:rows.map(r=>({id:r.id,version:r.version,status:r.status,parentId:r.parent_id,title:JSON.parse(r.body).title as string,use:inspectionUse(db,r)})),total,hasMore:q.offset+rows.length<total};
});}
function recordsWhere(site:string,user:string,role:string,q:z.infer<typeof inspectionRegisterQuery>){
 const where=["i.site_id=?"],args:(string|number)[]=[site];if(q.from){where.push("json_extract(i.body,'$.date')>=?");args.push(q.from);}if(q.to){where.push("json_extract(i.body,'$.date')<=?");args.push(q.to);}if(q.status){where.push("i.status=?");args.push(q.status);}if(q.work==="mine"){where.push("i.owner_id=?");args.push(user);}if(q.work==="reviewable"){where.push("?='manager' AND i.owner_id!=? AND i.status='submitted'");args.push(role,user);}if(q.history==="current")where.push("NOT EXISTS(SELECT 1 FROM inspections c WHERE c.parent_id=i.id AND c.site_id=i.site_id)");if(q.keyword){where.push("(instr(lower(json_extract(i.body,'$.location')),lower(?))>0 OR instr(lower(json_extract(i.body,'$.performedBy')),lower(?))>0 OR instr(lower(json_extract(i.template_snapshot,'$.body.title')),lower(?))>0)");args.push(q.keyword,q.keyword,q.keyword);}
 return {sql:where.join(" AND "),args};
}
// 일괄 출력 대상: the register's filter minus drafts. Over 100 is refused whole — never a partial print.
export function inspectionRecordsForPrint(db:Db,site:string,user:string,role:string,q:z.infer<typeof inspectionRegisterQuery>){return read(db,()=>{
 if(q.status==="draft")throw new HttpError(400,"작성 중 초안은 일괄 출력하지 않습니다. 문서 상태 조건을 바꾸세요.");
 const {sql,args}=recordsWhere(site,user,role,q),rows=db.prepare(`SELECT i.* FROM inspections i WHERE ${sql} AND i.status!='draft' ORDER BY created_at DESC,id DESC LIMIT 101`).all(...args) as InspectionRow[];
 if(rows.length>100)throw new HttpError(409,"일괄 출력은 100건까지입니다. 일부만 출력하지 않습니다. 기록일·상태·문자 조건을 좁히세요.");
 return rows;
});}
export function inspectionRecordsRegister(db:Db,site:string,user:string,role:string,q:z.infer<typeof inspectionRegisterQuery>){return read(db,()=>{
 const {sql,args}=recordsWhere(site,user,role,q),total=Number(db.prepare(`SELECT COUNT(*) n FROM inspections i WHERE ${sql}`).get(...args)?.n),rows=db.prepare(`SELECT i.* FROM inspections i WHERE ${sql} ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`).all(...args,q.offset) as InspectionRow[];
 return {items:rows.map(r=>{const v=inspectionRecord(r);return {id:r.id,status:r.status,version:r.version,ownerId:r.owner_id,parentId:r.parent_id,date:v.body.date,location:v.body.location,title:v.template_snapshot.body.title};}),total,hasMore:q.offset+rows.length<total};
});}
