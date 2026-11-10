import type {Express} from "express";
import {audit,type Db} from "./db.js";
import {HttpError,type SiteOperations} from "./site-operations.js";
import {getTemplate,account,inspectionRecord} from "./inspection-model.js";
import {inspectionLinks} from "./inspection-links.js";
import {inspectionTaskSource} from "./inspection-schedule-model.js";
import {printInspections} from "./inspection-print.js";
import {boundedCostOutput} from "./cost-output.js";
import {inspectionUse,inspectionStopInput,templateFingerprint,rawInspectionHash,type InspectionStop} from "./inspection-use.js";
import {taskRegisterQuery,templateRegisterQuery,inspectionRegisterQuery,inspectionTasksRegister,inspectionTemplatesRegister,inspectionRecordsRegister,inspectionRecordsForPrint} from "./inspection-register.js";
export function registerInspectionWorkflow(app:Express,db:Db,{access,mutate}:SiteOperations){
 const base="/api/sites/:siteId";
 app.get(base+"/inspection-task-register",(req,res)=>{const role=access(req);res.json(inspectionTasksRegister(db,String(req.params.siteId),req.session.userId!,role,taskRegisterQuery.parse(req.query)));});
 app.get(base+"/inspection-template-register",(req,res)=>{access(req);res.json(inspectionTemplatesRegister(db,String(req.params.siteId),templateRegisterQuery.parse(req.query)));});
 app.get(base+"/inspection-register",(req,res)=>{const role=access(req);res.json(inspectionRecordsRegister(db,String(req.params.siteId),req.session.userId!,role,inspectionRegisterQuery.parse(req.query)));});
 app.get(base+"/inspection-register/print",(req,res)=>{
  const role=access(req),site=String(req.params.siteId),q=inspectionRegisterQuery.parse(req.query);
  const items=inspectionRecordsForPrint(db,site,req.session.userId!,role,q).map(r=>({record:inspectionRecord(r),links:inspectionLinks(db,site,r.id),taskSource:inspectionTaskSource(db,site,r.id)}));
  const filter=[q.from||q.to?`기록일 ${q.from||"처음"}~${q.to||"끝"}`:"기록일 전체",q.status?`상태 ${q.status}`:"초안 제외 전체",q.work==="mine"?"내 작성 기록":q.work==="reviewable"?"내 검토가능 제출본":"현장 전체",q.history==="all"?"과거 기록 포함":"후속 없는 현재 기록",q.keyword?`문자 "${q.keyword}"`:""].filter(Boolean).join(" · ");
  res.set("Cache-Control","no-store").type("html").send(boundedCostOutput(printInspections(items,filter)));
 });
 app.get(base+"/inspection-templates/:id/use-status",(req,res)=>{access(req);res.json(inspectionUse(db,getTemplate(db,String(req.params.siteId),String(req.params.id))));});
 app.post(base+"/inspection-templates/:id/stop-use",(req,res)=>{
  access(req,true,true);const v=inspectionStopInput.parse(req.body),site=String(req.params.siteId),id=String(req.params.id);
  mutate(req,res,`inspection_template:stop-use:${site}:${id}`,v,()=>{
   const row=getTemplate(db,site,id);if(row.version!==v.version||templateFingerprint(row)!==v.sourceHash)throw new HttpError(409,"게시 양식 선택이 바뀌었습니다.");if(inspectionUse(db,row).useStopped)throw new HttpError(409,"이미 신규사용 중지된 양식입니다. 해제는 지원하지 않습니다.");
   const snapshot:InspectionStop={templateId:id,siteId:site,version:v.version,sourceHash:v.sourceHash,reason:v.reason,actor:account(db,req.session.userId!),at:new Date().toISOString()},json=JSON.stringify(snapshot);
   db.prepare("INSERT INTO inspection_template_use_stops VALUES(?,?,?,?,?,?)").run(id,site,v.version,v.sourceHash,json,rawInspectionHash(json));audit(db,req.session.userId!,site,"inspection_template.use_stopped",id);return inspectionUse(db,row);
  },()=>{access(req,true,true);getTemplate(db,site,id);});
 });
}
