import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { getCostPeriod, costTotals, readCostSettings, type CostSnapshot } from "./cost-model.js";
import { baselineView, currentBaselineSource } from "./cost-baseline-model.js";
import { printCostPeriod } from "./cost-print.js";
import { printCostBaseline } from "./cost-baseline-print.js";
import { journalHash } from "./daily-journal-sources.js";
import { escapeHtml as e } from "./print.js";
const fields = { closureId:z.uuid().optional(), baselineId:z.uuid().optional() };
export const outputSelection = z.object(fields).strict().refine(v=>!(v.closureId&&v.baselineId));
const checkedSelection=z.object({...fields,expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(v=>!(v.closureId&&v.baselineId));
export type OutputSelection = z.infer<typeof outputSelection>;
export function boundedCostOutput(text:string) {
  if(Buffer.byteLength(text)>4*1024*1024) throw new HttpError(409,"출력 전체 4MiB 한도 초과. 기존 고정 원문 또는 개별 자료를 확인하세요. 일부만 최신으로 표시하지 않습니다.");
  return text;
}
export function fixed(db:Db,site:string,period:string,id:string,month:string) {
  const row=db.prepare('SELECT body,hash FROM cost_closures WHERE id=? AND period_id=?').get(id,period) as {body:string;hash:string}|undefined;
  if(!row)throw new HttpError(404,'선택한 마감본을 찾을 수 없습니다.');
  boundedCostOutput(row.body);
  const body=JSON.parse(row.body) as CostSnapshot;
  if(body.schema!==1||body.id!==id||body.site.id!==site||body.period.id!==period||body.period.month!==month||journalHash(body)!==row.hash||body.expenses.length>1000||body.period.categories.length>20||body.expenses.some(x=>x.period_id!==period||!['active','cancelled'].includes(x.status))||new Set(body.expenses.map(x=>x.id)).size!==body.expenses.length||new Set(body.period.categories.map(x=>x.id)).size!==body.period.categories.length||JSON.stringify(costTotals(body.period.categories,body.expenses))!==JSON.stringify(body.totals))throw new HttpError(409,'마감 출처를 검증할 수 없습니다. 최신 여부 확인 불가.');
  return {body,hash:row.hash};
}
export function costOutput(db:Db,site:string,periodId:string,selection:OutputSelection) {
  const period=getCostPeriod(db,site,periodId);
  if((period.status==='closed')!==Boolean(period.current_close_id))throw new HttpError(409,'원장 상태와 현재 마감 불일치: 최신 여부 확인 불가.');
  const current=currentBaselineSource(db,site,periodId);
  const siteName=(db.prepare('SELECT name FROM sites WHERE id=?').get(site) as {name:string}).name;
  const closureId=selection.closureId|| (selection.baselineId?baselineView(db,site,periodId,selection.baselineId).body.closureId:period.current_close_id);
  let html:string, sourceHash:string|null=null;
  if(closureId){
    const stored=fixed(db,site,periodId,closureId,period.month);sourceHash=stored.hash;
    if(selection.baselineId){const baseline=baselineView(db,site,periodId,selection.baselineId);sourceHash=baseline.hash;html=printCostBaseline(baseline.body,baseline.hash);}
    else html=printCostPeriod(stored.body,stored.hash);
    if(closureId===period.current_close_id&&(JSON.stringify(stored.body.period)!==JSON.stringify(current.period)||JSON.stringify(stored.body.expenses)!==JSON.stringify(current.expenses)||JSON.stringify(stored.body.totals)!==JSON.stringify(current.totals)))throw new HttpError(409,'현재 마감과 원장 불일치: 최신 여부 확인 불가.');
  }else html=printCostPeriod({site:{id:site,name:siteName},period:current.period,expenses:current.expenses,totals:current.totals,settings:readCostSettings(db,periodId)},null);
  const status=closureId&&closureId!==period.current_close_id?'historical' as const:'current' as const;
  const facts={selection,siteId:site,periodId,month:period.month,sourceHash,closureId:closureId||null,currentVersion:period.version,currentStatus:period.status,currentCloseId:period.current_close_id,status};
  boundedCostOutput(html);
  const fingerprint=journalHash({facts,current,siteName,html});
  return {context:{...facts,fingerprint,queriedAt:new Date().toISOString()},html};
}
export type CostOutputContext=ReturnType<typeof costOutput>['context'];
export function checkedCostHtml(result:ReturnType<typeof costOutput>) {
 const c=result.context;
 const notice=`<section><h2>비용 출력 최신성 확인</h2><p>${c.status==='historical'?'정상적인 과거 고정 기록입니다. 현재 원장을 대신하지 않습니다.':'조회 시 현재 금융 자료와 일치합니다. 이후 최신성을 보장하지 않습니다.'}</p><p>조회 ${e(c.queriedAt)} · 월 ${e(c.month)} · 원장 ${e(c.periodId)} · 현재 v${c.currentVersion} ${e(c.currentStatus)} · 현재 마감 ${e(c.currentCloseId||'없음')}</p><p>선택 마감 ${e(c.closureId||'없음')} · 기준본 ${e(c.selection.baselineId||'없음')} · 원문 해시 ${e(c.sourceHash||'미마감 현재 자료')} · 확인 지문 ${e(c.fingerprint)}</p><p>금융 자료만 확인합니다. 증빙 파일 최신성·적격성, 실제 인쇄/PDF 생성·완료·전송을 확인하지 않습니다. 과거본은 오류가 아니며 원문은 보존됩니다.</p></section>`;
 return boundedCostOutput(result.html.replace('<main>','<main>'+notice));
}
export function registerCostOutput(app:Express,db:Db,{access}:SiteOperations){
 const base='/api/sites/:siteId/cost-periods/:id/output';
 for(const action of ['prepare','print'] as const)app.get(`${base}/${action}`,(req,res)=>{
  const input=action==='prepare'?outputSelection.parse(req.query):checkedSelection.parse(req.query);
  db.exec('BEGIN DEFERRED');let result:ReturnType<typeof costOutput>;
  try{access(req,true,true);result=costOutput(db,String(req.params.siteId),String(req.params.id),{...(input.closureId?{closureId:input.closureId}:{}),...(input.baselineId?{baselineId:input.baselineId}:{})});db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  // Strip expectedFingerprint from the hashed selector, which is not a source fact.
  res.set('Cache-Control','no-store');
  if(action==='prepare'){checkedCostHtml(result);return res.json(result.context);}
  if(result.context.fingerprint!==(input as z.infer<typeof checkedSelection>).expectedFingerprint)throw new HttpError(409,'준비 뒤 금융 자료 또는 표시 내용이 변경되었습니다. 다시 준비하세요.');
  return res.type('html').send(checkedCostHtml(result));
 });
}
