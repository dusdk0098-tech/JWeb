import { CostOutputControl } from "./CostOutputControl";
import { CostEvidenceComparison } from "./CostEvidenceComparison";
import { useDraftGuard } from "./useDraftGuard";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { CostPeriod } from "./cost-types";
import type { CostBaseline, Statement, costBaselineComparison } from "../server/cost-baseline-model";
const noBusy = (_busy:boolean) => {};
type Baseline = {id:string;hash:string;body:CostBaseline};
type Summary = {id:string;closure_id:string;hash:string;created_at:string};
type StatementView={body:Statement;hash:string};
type Page<T>={items:T[];hasMore:boolean};
export function CostBaselines({base,period,onDirtyChange,onBusyChange}:{base:string;period:CostPeriod;onDirtyChange:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void}) {
  const [page,setPage]=useState<Page<Summary>>({items:[],hasMore:false}),[offset,setOffset]=useState(0),[selected,setSelected]=useState<Baseline|null>(null),[statements,setStatements]=useState<Page<StatementView>>({items:[],hasMore:false}),[statementOffset,setStatementOffset]=useState(0),[comparison,setComparison]=useState<ReturnType<typeof costBaselineComparison>|null>(null),[memo,setMemo]=useState(''),[submittedDate,setDate]=useState(''),[statementMemo,setStatementMemo]=useState(''),[correctsId,setCorrects]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dirty=Boolean(memo||submittedDate||statementMemo||correctsId||confirmed);
  const guard=useDraftGuard(dirty,busy,onDirtyChange,onBusyChange||noBusy);
  async function run(fn:()=>Promise<void>) {setBusy(true);setError('');try {await fn();} catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function list(at=offset) { const result=await api<Page<Summary>>(`${base}/baselines?offset=${at}`);setPage(result);setOffset(at); }
  // 들어오면 바로 목록을 보여 준다(새로고침을 눌러야 보이던 것).
  useEffect(()=>{void run(()=>list(0));},[base]);
  async function open(id:string,at=0) {
    const value=await api<Baseline>(`${base}/baselines/${id}`);
    const records=await api<Page<StatementView>>(`${base}/baselines/${id}/statements?offset=${at}`);
    setSelected(value);setStatements(records);setStatementOffset(at);setComparison(null);
  }
  return <section><h3>월 비용 기준본 · 수기 제출 진술</h3>
    <p>현재 마감본을 고정 비용 기준본으로 보존합니다. 외부 전송·접수·열람이나 법정 비용 적격성을 증명하지 않습니다. 재고·보호구 기록은 비용 비교에 포함하지 않습니다.</p>
    <button disabled={busy||dirty} onClick={()=>void run(()=>list(0))}>기준본 목록 새로고침</button>
    {error&&<p role="alert">{error}</p>}
    {period.status==='closed'&&period.currentClosure&&<form onSubmit={event=>{event.preventDefault();void run(async()=>{
      const command={version:period.version,closureId:period.currentClosure!.id,closureHash:period.currentClosure!.hash,memo};
      const value=await api<Baseline>(`${base}/baselines`,'POST',command,guard.key(`${base}/baselines`,command));
      setMemo('');await list(0);await open(value.id);
    });}}><p>현재 마감 {period.currentClosure.id} · {period.currentClosure.hash}</p><label>기준본 생성 메모 <textarea required maxLength={1000} value={memo} disabled={busy||Boolean(submittedDate||statementMemo)} onChange={e=>setMemo(e.target.value)}/></label><button disabled={busy||Boolean(submittedDate||statementMemo)}>이 마감본의 기준본 생성</button></form>}
    {period.status!=='closed'&&<p>미마감 원장에서는 새 기준본을 만들지 않습니다. 과거 기준본은 그대로 조회할 수 있습니다.</p>}
    {page.items.map(row=><p key={row.id}><button disabled={busy||dirty} onClick={()=>void run(()=>open(row.id))}>{row.created_at} · {row.id}</button> 마감 {row.closure_id}</p>)}
    <button disabled={busy||dirty||offset===0} onClick={()=>void run(()=>list(offset-50))}>이전 50</button><button disabled={busy||dirty||!page.hasMore} onClick={()=>void run(()=>list(offset+50))}>다음 50</button>
    {selected&&<section><h4>선택 기준본 {selected.id}</h4><p>마감 {selected.body.closureId} · {selected.hash}</p><p>{selected.body.memo}</p>{selected.body.closureId!==period.currentClosure?.id&&<p>화면에 열린 원장의 현재 마감과 다른 과거 기준본입니다. 새 기준본/제출 진술로 자동 승계하지 않습니다. 최신 여부는 현재 비교를 다시 조회하세요.</p>}
      <a href={`/api${base}/baselines/${selected.id}/export`}>고정 JSON</a>{' '}<a href={`/api${base}/baselines/${selected.id}/print`} target="_blank" rel="noreferrer">고정 인쇄 HTML</a>
      <button disabled={busy||dirty} onClick={()=>{setComparison(null);void run(async()=>{try {setComparison(await api(`${base}/baselines/${selected.id}/compare`));}catch(e){setComparison({available:false,asOf:new Date().toISOString(),baselineId:selected.id,reason:`비교 요청 실패: ${(e as Error).message}`});}});}}>같은 월 현재 원장과 비교</button>
      {!comparison&&<p>현재 비교 미조회. 차이 없음으로 해석하지 마세요.</p>}
      {comparison&&(comparison.available?<><p>조회 시각 {comparison.asOf} · 현재 v{comparison.currentVersion} {comparison.currentStatus} · {comparison.changed?'변경 있음':'조회한 범위에서 차이 없음'}</p><p>같은 제목이라도 UUID가 다르면 별개입니다. 소수6자리 정확 차액, 자동 합침/수정 없음.</p>{comparison.changes.map((change,i)=><pre key={i}>{JSON.stringify(change,null,2)}</pre>)}</>:<p role="alert">비교 불가 · {comparison.reason} · {comparison.asOf}</p>)}
      <CostOutputControl key={`${base}:${selected.id}:${period.version}:${busy}:${dirty}`} base={base} selection={{baselineId:selected.id}} disabled={busy||dirty} />
      <CostEvidenceComparison key={`${base}:${selected.id}:${period.version}`} base={base} selection={{ baselineId: selected.id }} disabled={busy||dirty} />
      <form onSubmit={event=>{event.preventDefault();void run(async()=>{
        const command={baselineHash:selected.hash,submittedDate,memo:statementMemo,correctsId:correctsId||null,confirmHumanStatement:confirmed};
        await api(`${base}/baselines/${selected.id}/statements`,'POST',command,guard.key(`${base}/baselines/${selected.id}/statements`,command));
        setDate('');setStatementMemo('');setCorrects('');setConfirmed(false);await open(selected.id);
      });}}><h4>사람이 진술한 제출 기록 추가</h4><label>진술 제출일 <input required type="date" value={submittedDate} disabled={busy||Boolean(memo)} onChange={e=>setDate(e.target.value)}/></label><label>제출 내용/정정 사유 <textarea required maxLength={1000} value={statementMemo} disabled={busy||Boolean(memo)} onChange={e=>setStatementMemo(e.target.value)}/></label><label>정정 대상 기록 UUID (없으면 신규 진술) <input value={correctsId} disabled={busy||Boolean(memo)} onChange={e=>setCorrects(e.target.value)}/></label><label><input type="checkbox" required checked={confirmed} disabled={busy||Boolean(memo)} onChange={e=>setConfirmed(e.target.checked)}/>실제 전송·접수 증명이 아닌 내 수기 진술임을 확인합니다.</label><button disabled={busy||Boolean(memo)||!confirmed}>불변 진술 기록 추가</button></form>
      {statements.items.map(({body:s,hash})=><article key={s.id}><p>기록 {s.number} · {s.id} · 진술 제출일 {s.submittedDate} · 기록 시각 {s.recordedAt}</p><p>{s.actor.name} · {s.memo}</p><p>정정 대상 {s.correctsId||'없음'} · SHA-256 {hash}</p><a href={`/api${base}/baselines/${selected.id}/statements/${s.id}/print`} target="_blank" rel="noreferrer">이 진술 고정 HTML</a></article>)}
      <button disabled={busy||dirty||statementOffset===0} onClick={()=>void run(()=>open(selected.id,statementOffset-50))}>이전 50</button><button disabled={busy||dirty||!statements.hasMore} onClick={()=>void run(()=>open(selected.id,statementOffset+50))}>다음 50</button>
    </section>}
    {dirty&&<button disabled={busy} onClick={()=>{if(confirm('입력 중인 기준본 메모/제출 진술을 버릴까요?')){setMemo('');setDate('');setStatementMemo('');setCorrects('');setConfirmed(false);}}}>미저장 입력 버리기</button>}
  </section>;
}
