import { MinutesAttachments } from "./MinutesAttachments";
import { Fragment } from "react";
import { AiPolish } from "./AiDescriptionSuggest";
import { ActionBar, Notice, TechDetails } from "./ui";
import { MinutesFollowupsPanel } from "./MinutesFollowupsPanel";
import { useDraftGuard } from "./useDraftGuard";
import { useState } from "react";
import { api, type Meeting, type Site, type User } from "./api";
import { lastPlace, rememberPlace } from "./lastPlace";
const empty = (): Omit<Meeting, "id" | "version"> => ({
  title: "",
  type: "안전보건협의체",
  date: new Date().toLocaleDateString("en-CA"),
  time: "09:00",
  location: "",
  attendees: "",
  agenda: "",
  discussion: "",
  decisions: "",
  actions: [],
});
export function MeetingEditor({
  site,
  user,
  onDirtyChange,
  onBusyChange,
  initial,
  onClose,
  onSaved,
}: {
  site: Site;
  user: User;
  onDirtyChange: (v:boolean)=>void;
  onBusyChange: (v:boolean)=>void;
  initial: Meeting | null;
  onClose: () => void;
  onSaved: (m: Meeting) => void;
}) {
  const [value, setValue] = useState(initial || { ...empty(), location: lastPlace(site.id) });
  const [saved, setSaved] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState(crypto.randomUUID());
  const [revisionReason,setRevisionReason]=useState(""),[tracking,setTracking]=useState(false);
  const [attachmentsOpen,setAttachmentsOpen]=useState(false),[attachmentDirty,setAttachmentDirty]=useState(false),[attachmentBusy,setAttachmentBusy]=useState(false);
  const guard=useDraftGuard(dirty||!!revisionReason||attachmentDirty,busy||attachmentBusy,onDirtyChange,onBusyChange);
  const writable = site.role !== "viewer" && saved?.status!=="finalized";
  async function command(suffix:string,body:object){
    if(!saved||busy)return;setBusy(true);setError("");
    const path=`/sites/${site.id}/minutes/${saved.id}${suffix}`,input={version:saved.version,...body};
    try{const next=await api<Meeting>(path,"POST",input,guard.key(path,input));setSaved(next);setValue(next);setDirty(false);setRevisionReason("");onSaved(next);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function openLinked(id:string){if(!guard.canLeave())return;setBusy(true);setError("");try{const next=await api<Meeting>(`/sites/${site.id}/minutes/${id}`);setSaved(next);setValue(next);setDirty(false);setRevisionReason("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function change<K extends keyof typeof value>(
    field: K,
    next: (typeof value)[K],
  ) {
    setValue({ ...value, [field]: next });
    setDirty(true);
    setError("");
    setKey(crypto.randomUUID());
  }
  const close = () => { if(guard.canLeave())onClose(); };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const {
        title,
        type,
        date,
        time,
        location,
        attendees,
        agenda,
        discussion,
        decisions,
        actions,
      } = value;
      const input = {
        title,
        type,
        date,
        time,
        location,
        attendees,
        agenda,
        discussion,
        decisions,
        actions,
      };
      rememberPlace(site.id, location);
      const result = await api<Meeting>(
        `/sites/${site.id}/minutes${saved ? "/" + saved.id : ""}`,
        saved ? "PUT" : "POST",
        { ...input, ...(saved ? { version: saved.version } : {}) },
        key,
      );
      setSaved(result);
      setDirty(false);
      setKey(crypto.randomUUID());
      onSaved(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if(attachmentsOpen&&saved)return <section><button disabled={attachmentDirty||attachmentBusy} onClick={()=>setAttachmentsOpen(false)}>회의록으로 돌아가기</button><MinutesAttachments siteId={site.id} record={saved} editable={site.role==="manager"&&saved.status!=="finalized"} disabled={busy} onBusy={setAttachmentBusy} onDirty={setAttachmentDirty} onRecord={next=>{setSaved(next);setValue(next);setDirty(false);onSaved(next);}}/></section>;
  if(tracking && saved)return <MinutesFollowupsPanel site={site} user={user} meeting={saved} onClose={()=>setTracking(false)} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange}/>;
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          <h2>{saved?.status==="finalized" ? "확정 회의록" : saved ? "회의록 초안 보기 / 수정" : "새 회의록"}</h2>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={close}
          disabled={busy}
        >
          목록으로
        </button>
      </div>
      <Notice summary="관리자 확정은 기록 보관입니다. 서명이나 이수 증명이 아닙니다.">
        관리자 확정은 기록 보관이며 참석자 본인·서명·교육 이수·법적 적합성을 증명하지 않습니다. 첨부는 미검사 원본 다운로드만 지원하며 전자서명은 지원하지 않습니다.
      </Notice>
      {saved && <TechDetails><p>회의록 {saved.id} · v{saved.version}</p></TechDetails>}
      {saved?.parentId && <p>정정 사유: {saved.revisionReason} <button disabled={busy} onClick={()=>void openLinked(saved.parentId!)}>이전 확정본 보기</button></p>}
      {saved&&<button disabled={busy} onClick={()=>{if(guard.canLeave()){setValue(saved);setDirty(false);setRevisionReason("");setAttachmentsOpen(true);}}}>원본 첨부 · 보존 목록</button>}
      <form onSubmit={save}>
        <fieldset disabled={!writable || busy}>
          <div className="grid">
            <label>
              회의 종류
              <select
                value={value.type}
                onChange={(e) =>
                  change("type", e.target.value as Meeting["type"])
                }
              >
                <option>안전보건협의체</option>
                <option>기타</option>
              </select>
            </label>
            <label>
              제목 *
              <input
                required
                maxLength={200}
                value={value.title}
                onChange={(e) => change("title", e.target.value)}
              />
            </label>
            <label>
              회의 날짜 *
              <input
                required
                type="date"
                value={value.date}
                onChange={(e) => change("date", e.target.value)}
              />
            </label>
            <label>
              회의 시간 *
              <input
                required
                type="time"
                value={value.time}
                onChange={(e) => change("time", e.target.value)}
              />
            </label>
            <label className="wide">
              장소 *
              <input
                required
                maxLength={200}
                value={value.location}
                onChange={(e) => change("location", e.target.value)}
              />
            </label>
          </div>
          {(["attendees", "agenda", "discussion", "decisions"] as const).map(
            (field, index) => (
              <Fragment key={field}>
              <label>
                {
                  ["참석자 · 소속 · 역할", "안건", "논의 내용", "결정 사항"][
                    index
                  ]
                }
                <textarea
                  rows={field === "discussion" ? 6 : 3}
                  maxLength={20000}
                  value={value[field]}
                  onChange={(e) => change(field, e.target.value)}
                  placeholder={
                    field === "attendees"
                      ? "한 줄에 한 명씩 이름 / 소속 / 역할을 입력하세요."
                      : ""
                  }
                />
              </label>
              {field === "decisions" && writable && <AiPolish siteId={site.id} kind="minutes_decisions" text={value.decisions} onApply={(v) => change("decisions", v)} />}
              </Fragment>
            ),
          )}
          <div className="section-head">
            <h3>후속 조치</h3>
            <button
              type="button"
              className="secondary"
              disabled={value.actions.length >= 50}
              onClick={() =>
                change("actions", [
                  ...value.actions,
                  { task: "", owner: "", due: value.date, status: "대기" },
                ])
              }
            >
              + 조치 추가
            </button>
          </div>
          {value.actions.map((action, i) => (
            <div className="action-row" key={i}>
              {(["task", "owner", "due", "status"] as const).map((f, j) => (
                <label key={f}>
                  {["할 일 *", "담당자 *", "기한 *", "진행 상태"][j]}
                  {f === "status" ? (
                    <select
                      value={action.status}
                      onChange={(e) =>
                        change(
                          "actions",
                          value.actions.map((a, n) =>
                            n === i
                              ? {
                                  ...a,
                                  status: e.target
                                    .value as typeof action.status,
                                }
                              : a,
                          ),
                        )
                      }
                    >
                      <option>대기</option>
                      <option>진행</option>
                      <option>완료</option>
                    </select>
                  ) : (
                    <input
                      required
                      maxLength={200}
                      type={f === "due" ? "date" : "text"}
                      value={action[f]}
                      onChange={(e) =>
                        change(
                          "actions",
                          value.actions.map((a, n) =>
                            n === i ? { ...a, [f]: e.target.value } : a,
                          ),
                        )
                      }
                    />
                  )}
                </label>
              ))}
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  change(
                    "actions",
                    value.actions.filter((_, n) => n !== i),
                  )
                }
              >
                삭제
              </button>
            </div>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <ActionBar note={<span role="status">{dirty ? "저장하지 않은 변경사항" : saved ? "서버에 저장됨" : ""}</span>}>
          {writable && (
            <button disabled={busy || (!dirty && !!saved)}>
              {busy ? "저장 중…" : "초안 저장"}
            </button>
          )}
          {saved && (
            <a
              className="button secondary"
              href={`/api/sites/${site.id}/minutes/${saved.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              저장본 인쇄 / PDF
            </a>
          )}
        </ActionBar>
        {dirty && saved && (
          <p className="muted">
            인쇄는 마지막으로 저장된 버전입니다. 변경 내용을 먼저 저장하세요.
          </p>
        )}
      </form>
      {saved?.status!=="finalized"&&saved&&site.role==="manager"&&<button disabled={busy||dirty} onClick={()=>{if(window.confirm("기록을 확정하면 원문을 수정할 수 없습니다. 전자서명이나 법적 인증이 아닙니다. 계속할까요?"))void command("/finalize",{confirmRecordOnly:true});}}>관리자가 기록 확정</button>}
      {saved?.status==="finalized"&&<section><TechDetails><p>고정 SHA-256: {saved.snapshot?.hash}</p></TechDetails><p>확정 계정: {saved.snapshot?.body.finalizedBy.name} · {saved.snapshot?.body.finalizedAt}</p>
        <button disabled={busy||!!revisionReason} onClick={()=>setTracking(true)}>이 회의의 별도 후속조치 기록</button>
        {saved.successorId ? <button disabled={busy} onClick={()=>void openLinked(saved.successorId!)}>연결된 정정본 보기</button> : site.role==="manager"&&<><label>정정 사유<input maxLength={1000} disabled={busy} value={revisionReason} onChange={e=>setRevisionReason(e.target.value)}/></label><button disabled={busy||!revisionReason.trim()} onClick={()=>void command("/revise",{reason:revisionReason})}>원문을 보존하고 정정 초안 만들기</button></>}
      </section>}
    </section>
  );
}
