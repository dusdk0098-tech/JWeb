import { EducationAttachments } from "./EducationAttachments";
import { ActionBar, Notice, TechDetails } from "./ui";
import { CatalogCurrentWarning } from "./CatalogCurrentWarning";
import { EducationCatalogProvenance } from "./EducationCatalogProvenance";
import { useEffect, useRef, useState } from "react";
import { api, type Site, type User } from "./api";
import { lastPlace, rememberPlace } from "./lastPlace";
import type { EducationInput, EducationFull } from "./education-types";
import { useDraftGuard } from "./useDraftGuard";
import { EducationParticipants } from "./EducationParticipants";
import { TbmInvitations } from "./TbmInvitations";
const empty = (): EducationInput => ({
  title: "",
  courseLabel: "",
  instructor: "",
  date: new Date().toLocaleDateString("en-CA"),
  startTime: "09:00",
  endTime: "10:00",
  breakMinutes: 0,
  location: "",
  objectives: "",
  contents: "",
});
export function EducationEditor({
  site,
  user,
  initial,
  onClose,
  onOpen,
  onRevision,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  initial: EducationFull | null;
  onClose: () => void;
  onOpen: (id: string) => Promise<void>;
  onRevision: (r: EducationFull) => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [form, setForm] = useState(initial?.body || { ...empty(), instructor: user.name, location: lastPlace(site.id) }),
    [participantDirty, setParticipantDirty] = useState(false),
    [reason, setReason] = useState(""),
    [authorId, setAuthorId] = useState(initial?.author_id || user.id),
    [authors, setAuthors] = useState<{ id: string; name: string }[]>([]),
    [working, setBusy] = useState(false),
    [error, setError] = useState("");
  const [attachmentDirty,setAttachmentDirty]=useState(false),[attachmentBusy,setAttachmentBusy]=useState(false);
  const busy=working||attachmentBusy;
  const [participantEpoch, setParticipantEpoch] = useState(0);
  const baseline = useRef(JSON.stringify(form)),
    formDirty = JSON.stringify(form) !== baseline.current,
    actionDirty = !!reason || authorId !== (record?.author_id || user.id),
    dirty = formDirty || participantDirty || actionDirty || attachmentDirty,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  const editable =
    site.role !== "viewer" &&
    (!record || (record.status === "draft" && record.author_id === user.id));
  useEffect(() => {
    if (site.role !== "manager") return;
    let active = true;
    api<{ id: string; name: string }[]>(`/sites/${site.id}/education/authors`)
      .then((r) => {
        if (active) setAuthors(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [site.id, site.role]);
  function adopt(next: EducationFull) {
    setRecord(next);
    rememberPlace(site.id, next.body.location);
    setForm(next.body);
    baseline.current = JSON.stringify(next.body);
    setReason("");
    setAuthorId(next.author_id);
    setParticipantDirty(false);
    setParticipantEpoch((v) => v + 1);
  }
  async function run(action: "save" | "archive" | "revise") {
    if (busy) return;
    if (participantDirty || (action !== "save" && formDirty)) {
      setError("변경한 본문/참여 입력을 먼저 저장하거나 취소하세요.");
      return;
    }
    const path = `/sites/${site.id}/education${record ? "/" + record.id : ""}${action === "save" ? "" : "/" + action}`,
      value =
        action === "save"
          ? { ...form, ...(record ? { version: record.version } : {}) }
          : action === "archive"
            ? { version: record!.version }
            : { version: record!.version, reason, authorId };
    setBusy(true);
    setError("");
    try {
      const next = await api<EducationFull>(
        path,
        action === "save" && record ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      if (action === "revise") onRevision(next);
      else adopt(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (!record || !guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      adopt(
        await api<EducationFull>(`/sites/${site.id}/education/${record.id}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function linked(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      await onOpen(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      {record?.catalogSource&&<CatalogCurrentWarning path={`/sites/${site.id}/education/${record.id}`} disabled={busy || attachmentDirty}/>}
      <div className="section-head">
        <h1>
          교육일지 ·{" "}
          {record?.status === "archived" ? "확정" : "초안"}
        </h1>
        <button
          className="secondary"
          disabled={busy || attachmentDirty}
          onClick={() => guard.canLeave() && onClose()}
        >
          교육일지 목록으로
        </button>
      </div>
      <Notice summary="교육 내용과 참여를 직접 기록합니다. 이수증이 아닙니다.">
        직접 작성 교육내용과 담당자 수기 참여 기록입니다. 법정 과정
        카탈로그·본인 확인·서명·교육 이수증·안전 인증이 아닙니다. 관리자 보관은
        내용 보존이며 독립 승인이나 법적 이수 판정이 아닙니다.
      </Notice>
      {record && (
        <TechDetails>
          <p>
            기록 {record.id} · v{record.version} · 원 작성 계정 {record.author_id}{" "}
            · 이전 보관본 {record.parent_id || "없음"}
          </p>
        </TechDetails>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy || attachmentDirty || !editable || participantDirty}>
        <label>
          교육 제목
          <input
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          자체 과정/유형 표시
          <input
            maxLength={200}
            value={form.courseLabel}
            onChange={(e) => setForm({ ...form, courseLabel: e.target.value })}
          />
        </label>
        <label>
          강사 표시 (직접 입력)
          <input
            maxLength={200}
            value={form.instructor}
            onChange={(e) => setForm({ ...form, instructor: e.target.value })}
          />
        </label>
        <label>
          교육 날짜
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            시작 시각
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </label>
          <label>
            종료 시각 (같은 날)
            <input
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </label>
          <label>
            휴게시간 (분)
            <input
              type="number"
              min={0}
              max={1438}
              step={1}
              value={form.breakMinutes}
              onChange={(e) =>
                setForm({ ...form, breakMinutes: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <p>
          자정 넘김은 지원하지 않습니다. 시각 차이에서 휴게를 뺀 예정 분 수를
          서버가 계산합니다. 시간대/DST를 반영한 실제 경과시간이 아닙니다.
        </p>
        <label>
          교육 장소
          <input
            maxLength={300}
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </label>
        <label>
          교육 목표
          <textarea
            maxLength={5000}
            value={form.objectives}
            onChange={(e) => setForm({ ...form, objectives: e.target.value })}
          />
        </label>
        <label>
          직접 작성 교육내용
          <textarea
            maxLength={10000}
            value={form.contents}
            onChange={(e) => setForm({ ...form, contents: e.target.value })}
          />
        </label>
      </fieldset>
      <ActionBar note={<span role="status">{formDirty ? "저장하지 않은 입력" : record ? "서버에 저장됨" : ""}</span>}>
        {editable && (
          <button
            disabled={busy || attachmentDirty || participantDirty}
            onClick={() => run("save")}
          >
            교육 초안 저장
          </button>
        )}
        {record && (
          <>
            <button disabled={busy || attachmentDirty} className="secondary" onClick={reload}>
              최신본 다시 열기
            </button>
            <a
              href={`/api/sites/${site.id}/education/${record.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              저장본 인쇄 / PDF
            </a>
          </>
        )}
      </ActionBar>
      {formDirty && record && (
        <p className="notice">
          본문 변경을 저장한 뒤 참여 기록을 변경할 수 있습니다. 예정시간을
          줄이려면 기존 수기 참여시간을 먼저 줄이세요.
        </p>
      )}
      {record && (
        <EducationParticipants
          key={record.id + ":" + record.status + ":" + participantEpoch}
          siteId={site.id}
          record={record}
          editable={editable && !formDirty && !attachmentDirty}
          busy={busy}
          onBusy={setBusy}
          onUpdated={setRecord}
          onDirty={setParticipantDirty}
        />
      )}
      {record && (
        <details className="advanced-tools">
          <summary>참여 링크 · QR</summary>
          {/* Not keyed by version: marking attendance must not take the QR off the screen while people are still scanning. */}
          <TbmInvitations kind="education" key={record.id} path={`/sites/${site.id}/education/${record.id}/invitations`} draft={record.status === "draft"} writable={editable} />
        </details>
      )}
      {" "}
      {record && <EducationAttachments siteId={site.id} record={record} editable={editable} disabled={working||formDirty||participantDirty||actionDirty} onBusy={setAttachmentBusy} onDirty={setAttachmentDirty} onRecord={setRecord} />}
      {record?.status === "draft" && site.role === "manager" && (
        <section className="panel">
          <h2>관리자 기록 보관</h2>
          <p>
            잠정 기록 정책: 필수 본문, 참석1명 이상, 미입력0명, 각 수기
            참여시간이 예정시간 이내. 보관 후 원문을 수정할 수 없습니다. 최소
            법정 교육시간 판정이 아닙니다.
          </p>
          <button
            disabled={busy || attachmentDirty || formDirty || participantDirty}
            onClick={() =>
              window.confirm(
                "현재 본문·수기 참여 기록과 별도 원본 목록을 보관할까요? 원본은 미검사이며 실제 참석·이수·전자서명 인증이 아닙니다.",
              ) && run("archive")
            }
          >
            관리자가 기록 확정
          </button>
        </section>
      )}
      {record?.catalogSource && (
        <EducationCatalogProvenance
          source={record.catalogSource}
          current={form}
          dirty={formDirty}
        />
      )}
      {record?.snapshot && (
        <section className="notice">
          <h2>불변 보관본</h2>
          <p>
            작성 계정 {record.snapshot.body.author.name} (
            {record.snapshot.body.author.id})
          </p>
          <p>
            보관 계정 {record.snapshot.body.archivedBy.name} (
            {record.snapshot.body.archivedBy.id}) ·{" "}
            {record.snapshot.body.archivedAt}
          </p>
          <p>내용 SHA-256 {record.snapshot.hash} · 전자서명 아님</p>
          <p>정정 사유 {record.revision_reason || "최초 기록"}</p>
        </section>
      )}
      {record?.status === "archived" && (
        <section className="panel">
          <h2>연결 정정 초안</h2>
          {record.successorId ? (
            <button disabled={busy || attachmentDirty} onClick={() => linked(record.successorId!)}>
              기존 후속 교육 초안 열기
            </button>
          ) : site.role === "manager" ? (
            <fieldset disabled={busy || attachmentDirty}>
              <label>
                정정 사유
                <textarea
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                후속 초안 작성 계정
                <select
                  value={authorId}
                  onChange={(e) => setAuthorId(e.target.value)}
                >
                  <option value="">선택</option>
                  {authorId && !authors.some((a) => a.id === authorId) && (
                    <option value={authorId}>
                      기존 작성자 권한 없음 · 다른 계정 선택
                    </option>
                  )}
                  {authors.map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name} ({a.id})
                    </option>
                  ))}
                </select>
              </label>
              <p>
                본문/명부 이름을 복사하지만 참여 상태·시간·기록자는 모두
                초기화합니다. 날짜/내용도 새로 확인하세요. 이전 보관본은 그대로
                남습니다.
              </p>
              <button
                disabled={
                  !reason.trim() || !authors.some((a) => a.id === authorId)
                }
                onClick={() =>
                  window.confirm(
                    "지정 계정의 정정 초안을 만들고 참여 기록을 초기화할까요?",
                  ) && run("revise")
                }
              >
                정정 초안 생성
              </button>
            </fieldset>
          ) : (
            <p>관리자만 정정 초안을 만들 수 있습니다.</p>
          )}
        </section>
      )}
    </section>
  );
}
