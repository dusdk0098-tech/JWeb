import { Notice } from "./ui";
import { useEffect, useRef, useState } from "react";
import { api, type Site } from "./api";
import type { HazardInbox, HazardInboxKind } from "../server/hazard-inbox";
export function HazardInboxPanel({site,onOpen,disabled=false}:{site:Site;onOpen:(id:string)=>void;disabled?:boolean}){
  const [kind,setKind]=useState<HazardInboxKind>('mine'),[result,setResult]=useState<HazardInbox|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0);
  useEffect(()=>{sequence.current++;setKind('mine');setResult(null);setError('');setBusy(false);return()=>{sequence.current++;};},[site.id,site.role]);
  useEffect(()=>{if(!disabled)void load(0);},[site.id,site.role,kind,disabled]);
  async function load(offset=0){const seq=++sequence.current;setBusy(true);setResult(null);setError('');try{
    const value=await api<HazardInbox>(`/sites/${site.id}/hazard-inbox?kind=${kind}&offset=${offset}`);
    if(sequence.current===seq)setResult(value);
  }catch(e){if(sequence.current===seq)setError((e as Error).message);}finally{if(sequence.current===seq)setBusy(false);}}
  return <section className="panel"><h2>내 신고 조치 · 검토 대기</h2><Notice summary="열면 현재 업무를 조회합니다. 새로고침으로 다시 불러옵니다.">현재 계정과 현장의 업무를 조회합니다. 알림 발송·읽음 확인·자동 처리 기능이 아닙니다.</Notice>
    <label>조회할 업무 <select value={kind} disabled={disabled||busy} onChange={e=>{setKind(e.target.value as HazardInboxKind);setResult(null);setError('');}}><option value="mine">내 배정 · 제출 후 검토 대기</option>{site.role==='manager'&&<option value="reviews">관리자 독립 검토 대기</option>}</select></label>
    <button disabled={disabled||busy} onClick={()=>void load(0)}>현재 업무 새로고침</button>
    {busy&&<p>조회 중</p>}{error&&<p role="alert">{error} · 조회 실패는 업무 0건이 아닙니다.</p>}
    {!result&&!busy&&!error&&<p>아직 조회하지 않았습니다. 대기 업무가 없다는 뜻이 아닙니다.</p>}
    
    {result&&<><p>현재 선택 종류 {result.total}건 · 조회 {result.retrievedAt} · 페이지 간 변경될 수 있습니다. 다른 종류와 합산한 현장 전체 업무 수가 아닙니다.</p>
      <p>초안·미배정 신고·종결은 제외합니다. 본인이 제출한 조치는 독립 검토 목록에서 제외되며 내 배정 목록의 검토 대기에 남습니다. 종결·반려 가능 여부는 상세에서 최신 상태와 권한으로 다시 확인합니다.</p>
      {result.items.length===0&&<p>이 조회 페이지에 표시할 업무가 없습니다.</p>}
      <ul>{result.items.map(item=><li key={item.id}><strong>{item.title}</strong><p>{item.stateLabel} · 예정일 {item.dueDate} · v{item.version} · {item.location}</p>
        {item.status==='review_requested'&&site.role==='manager'&&!item.canReturn&&<p>현재 담당자 역할 때문에 반려가 제한될 수 있습니다. 상세에서 담당자 배정을 확인하세요.</p>}
        <button disabled={disabled||busy} onClick={()=>onOpen(item.id)}>최신 신고 상세 열기</button></li>)}</ul>
      <button disabled={disabled||busy||result.offset===0} onClick={()=>void load(Math.max(0,result.offset-50))}>이전 50</button>
      <button disabled={disabled||busy||!result.hasMore} onClick={()=>void load(result.offset+50)}>다음 50</button>
    </>}
  </section>;
}
