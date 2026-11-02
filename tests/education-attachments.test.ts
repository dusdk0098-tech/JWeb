import { educationAttachmentFixture } from "./fixtures/education-attachment-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pdf, png } from "./fixtures/cost-evidence-fixture.js";
import { attachmentUsage, enforceAttachmentQuota } from "../server/attachment-quota.js";
import { EducationAttachments } from "../src/EducationAttachments.js";
import { EducationEditor } from "../src/EducationEditor.js";
import { boundedEducationManifest } from "../server/education-attachment-model.js";
import { tooLargeStatus } from "./fixtures/too-large.js";
test('education originals legacy payload, retained detach, fixed sidecar and revision no inheritance',async()=>{
 const f=await educationAttachmentFixture();try{
  const initial=await f.current(),key=randomUUID();let r=await f.upload(pdf,'<own>.pdf','application/pdf',key,initial.version);assert.equal(r.status,200,r.text);const file=r.body.attachments[0],v=r.body.record.version;assert.equal(v,initial.version+1);assert.deepEqual(r.body.record.body,initial.body);assert.deepEqual(r.body.record.participants,[]);
  assert.equal((await f.upload(pdf,'<own>.pdf','application/pdf',key,initial.version)).text,r.text);
  r=await f.send(f.url+`/attachments/${file.id}/state`,{version:v,attached:false,reason:'합성 분리'});assert.equal(r.status,200,r.text);assert.equal(attachmentUsage(f.db,f.site,f.id,'education').reportCount,1);
  r=await f.send(f.url+`/attachments/${file.id}/state`,{version:r.body.record.version,attached:true,reason:'합성 재연결'});assert.equal(r.status,200,r.text);
  const p=await f.ready();r=await f.send(f.url+'/archive',{version:p.version});assert.equal(r.status,200,r.text);const archived=r.body;
  assert.equal(archived.snapshot.body.attachmentManifest,undefined);assert.equal(archived.snapshot.body.schemaVersion,1);
  const snapshot=f.db.prepare('SELECT * FROM education_snapshots WHERE session_id=?').get(f.id),html=(await f.agent.get(f.siteBase+f.url+'/print')).text;
  const fixed=(await f.agent.get(f.siteBase+f.url+'/attachments/fixed')).body;assert.equal(fixed.recorded,true);assert.equal(fixed.snapshotHash,archived.snapshot.hash);assert.equal(fixed.manifest.items.length,1);
  const print=await f.agent.get(f.siteBase+f.url+'/attachments/fixed/print');assert.equal(print.status,200);assert.match(print.text,/&lt;own&gt;.pdf/);assert.doesNotMatch(print.text,/<img|<iframe|<script/);
  const download=await f.agent.get(f.siteBase+f.url+`/attachments/${file.id}/download`);assert.equal(download.status,200);assert.deepEqual(download.body,pdf);assert.equal(download.headers['x-attachment-scan'],'UNSCANNED');assert.equal(download.headers['cache-control'],'no-store');assert.equal(download.headers['x-content-type-options'],'nosniff');assert.match(download.headers['content-disposition'],/^attachment;/);
  assert.equal((await f.upload()).status,409);assert.equal((await f.send(f.url+`/attachments/${file.id}/state`,{version:archived.version,attached:false,reason:'불가'})).status,409);
  r=await f.send(f.url+'/revise',{version:archived.version,authorId:f.manager,reason:'합성 정정'});assert.equal(r.status,200,r.text);assert.equal(r.body.parent_id,f.id);assert.equal(r.body.participants[0].state,'pending');assert.equal(r.body.participants[0].attended_minutes,0);
  assert.deepEqual((await f.agent.get(f.siteBase+`/education/${r.body.id}/attachments`)).body,[]);
  assert.deepEqual(f.db.prepare('SELECT * FROM education_snapshots WHERE session_id=?').get(f.id),snapshot);assert.equal((await f.agent.get(f.siteBase+f.url+'/print')).text,html);
  assert.deepEqual((await f.agent.get(f.siteBase+f.url+'/attachments/fixed')).body,fixed);assert.throws(()=>f.db.exec('DELETE FROM education_attachments'));assert.throws(()=>f.db.exec('UPDATE education_archive_attachments SET hash=\'changed\''));
 }finally{f.db.close();}
});
test('education attachment guards format stale role other-manager and atomic archive failure',async()=>{
 const f=await educationAttachmentFixture();try{
  assert.equal((await f.upload(Buffer.from('not PDF'))).status,400);assert.equal((await tooLargeStatus(f.upload(Buffer.alloc(5*1024*1024+1)))),413);
  assert.equal((await f.upload(pdf,'wrong.png')).status,400);assert.equal((await f.upload(png,'own.png','image/png')).status,200);assert.equal((await f.upload(pdf,'stale.pdf','application/pdf',randomUUID(),1)).status,409);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.upload()).status,403);
  f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  const other=randomUUID();f.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(other,'other-edu@example.test','합성 다른 작성자','unused');f.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(f.site,other,'editor');
  // Synthetic author fixture: manager archive privilege must not imply attachment authorship.
  f.db.prepare('UPDATE education_sessions SET author_id=? WHERE id=?').run(other,f.id);assert.equal((await f.upload()).status,403);f.db.prepare('UPDATE education_sessions SET author_id=? WHERE id=?').run(f.manager,f.id);
  const p=await f.ready();const before=JSON.stringify(f.db.prepare('SELECT * FROM education_sessions WHERE id=?').get(f.id));
  f.db.exec("CREATE TRIGGER synthetic_education_manifest_failure BEFORE INSERT ON education_archive_attachments BEGIN SELECT RAISE(ABORT,'synthetic manifest failure'); END;");
  assert.equal((await f.send(f.url+'/archive',{version:p.version})).status,500);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM education_sessions WHERE id=?').get(f.id)),before);assert.equal(f.db.prepare('SELECT count(*) n FROM education_snapshots WHERE session_id=?').get(f.id)!.n,0);
  f.db.exec('DROP TRIGGER synthetic_education_manifest_failure');assert.equal((await f.send(f.url+'/archive',{version:p.version})).status,200);
 }finally{f.db.close();}
});
test('education shares retained quota with all four existing domains and exact manifest cap',async()=>{
 const f=await educationAttachmentFixture();try{
  for(let i=0;i<20;i++){const r=await f.upload();assert.equal(r.status,200,r.text);}assert.equal((await f.upload()).status,409);const file=(await f.agent.get(f.siteBase+f.url+'/attachments')).body[0];assert.equal((await f.send(f.url+`/attachments/${file.id}/state`,{version:(await f.current()).version,attached:false,reason:'분리 용량 보존'})).status,200);assert.equal((await f.upload()).status,409);
  // Other domain originals use their existing immutable schema and count in the same budget.
  const hash=createHash('sha256').update(pdf).digest('hex');const cost=(await f.current()).site_id;assert.equal(cost,f.site);await f.send(f.base+'/expenses',{version:(await f.agent.get(f.siteBase+f.base)).body.version,expense:{categoryId:(await f.agent.get(f.siteBase+f.base)).body.categories[0].id,spendDate:'2026-10-01',description:'합성',quantity:'1',unitPriceWon:'1'}});
  f.db.prepare("INSERT INTO cost_evidence_files VALUES(?,?,?,'cost.pdf','application/pdf',?,?,?,?,'now')").run(randomUUID(),f.site,f.base.split('/').pop()!,pdf.length,hash,pdf,f.manager);
  const m=await f.send('/minutes',{title:'합성 회의',type:'기타',date:'2026-10-28',time:'09:00',location:'합성',attendees:'합성',agenda:'합성',discussion:'합성',decisions:'합성',actions:[]});assert.equal(m.status,200,m.text);
  f.db.prepare("INSERT INTO minutes_attachments VALUES(?,?,?,'minutes.pdf','application/pdf',?,?,?,0,?,'now')").run(randomUUID(),f.site,m.body.id,pdf.length,hash,pdf,f.manager);
  const h=await f.send('/hazards',{title:'합성 신고',observedDate:'2026-10-28',location:'합성',description:'합성'});assert.equal(h.status,200,h.text);
  f.db.prepare("INSERT INTO hazard_attachments VALUES(?,?,?,'hazard.png','image/png',?,?,?,0,?,'now')").run(randomUUID(),f.site,h.body.id,png.length,createHash('sha256').update(png).digest('hex'),png,f.manager);
  const w=await f.send('/work-plans',{body:{title:'합성 계획',date:'2026-10-28',startTime:'09:00',endTime:'10:00',location:'합성',workDescription:'합성',emergencyProcedure:'합성',verificationNote:'합성',steps:[{task:'합성',procedure:'합성',precaution:'합성'}],equipmentIds:[],duties:[]}});assert.equal(w.status,200,w.text);
  f.db.prepare("INSERT INTO work_plan_attachments VALUES(?,?,?,'plan.pdf','application/pdf',?,?,?,0,?,'now')").run(randomUUID(),f.site,w.body.id,pdf.length,hash,pdf,f.manager);
  const usage=attachmentUsage(f.db,f.site,f.id,'education');assert.equal(usage.siteCount,24);assert.equal(usage.totalBytes,23*pdf.length+png.length);assert.equal(attachmentUsage(f.db,f.site,'none','hazard').siteCount,24);
  assert.throws(()=>enforceAttachmentQuota({...usage,siteCount:200},1));assert.throws(()=>enforceAttachmentQuota({...usage,siteBytes:100*1024*1024},1));assert.throws(()=>enforceAttachmentQuota({...usage,totalBytes:512*1024*1024},1));
  assert.equal(Buffer.byteLength(boundedEducationManifest('x'.repeat(256*1024-2))),256*1024);assert.throws(()=>boundedEducationManifest('x'.repeat(256*1024-1)));
 }finally{f.db.close();}
});
test('education parent SSR and attachment UI preserve author-only/no-preview/no-inheritance language',async()=>{
 const f=await educationAttachmentFixture();try{const record=await f.current();const noop=()=>{};const html=renderToStaticMarkup(createElement(EducationAttachments,{siteId:f.site,record,editable:false,disabled:false,onBusy:noop,onDirty:noop,onRecord:noop}));assert.match(html,/다른 관리자는/);assert.match(html,/정정은 첨부 없는 새 초안/);assert.match(html,/다섯 업무/);assert.doesNotMatch(html,/type="file"|<img|<iframe/);
 const parent=renderToStaticMarkup(createElement(EducationEditor,{site:{id:f.site,name:'합성',role:'manager',version:1},user:{id:f.manager,name:'합성',email:'synthetic@example.test'},initial:record,onClose:noop,onOpen:async()=>{},onRevision:noop,onDirtyChange:noop,onBusyChange:noop}));assert.match(parent,/교육일지 원본 첨부/);assert.match(parent,/관리자가 기록 확정/);
 }finally{f.db.close();}
});
