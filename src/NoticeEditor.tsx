import { NoticeHistory } from "./NoticeHistory";
import { ActionBar, Notice, TechDetails } from "./ui";
import { useRef, useState } from "react";
import { api, type Site } from "./api";
import {
  noticeStatus,
  type NoticeView,
  type NoticeContent,
  type NoticeTarget,
} from "./notice-types";
import { useDraftGuard } from "./useDraftGuard";
import { NoticeRecipients } from "./NoticeRecipients";
const empty = (): NoticeContent => ({
  title: "",
  workScope: "",
  applyDate: new Date().toLocaleDateString("en-CA"),
  text: "",
});
export function NoticeEditor({
  site,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initial: NoticeView | null;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [content, setContent] = useState(initial?.content || empty()),
    [targets, setTargets] = useState<NoticeTarget[]>(initial?.targets || []),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const signature = JSON.stringify({
      content,
      ids: targets.map((t) => t.user_id).sort(),
    }),
    baseline = useRef(signature),
    formDirty = signature !== baseline.current,
    dirty = formDirty || !!reason,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange),
    manager = site.role === "manager",
    editable = manager && (!record || record.status === "draft");
  function adopt(next: NoticeView) {
    setRecord(next);
    setContent(next.content);
    setTargets(next.targets || []);
    baseline.current = JSON.stringify({
      content: next.content,
      ids: (next.targets || []).map((t) => t.user_id).sort(),
    });
    setReason("");
  }
  async function run(
    action: "save" | "publish" | "withdraw" | "revise" | "acknowledge",
  ) {
    if (busy) return;
    if (action !== "save" && formDirty) {
      setError("변경한 초안을 먼저 저장하세요.");
      return;
    }
    if (
      action === "publish" &&
      !window.confirm(
        "내용과 수신 계정을 고정해 게시할까요? 후속 게시라면 이전 게시 공지를 대체합니다. 외부 발송은 하지 않습니다.",
      )
    )
      return;
    if (
      action === "acknowledge" &&
      !window.confirm(
        "이 게시 버전을 내 로그인 계정으로 확인했다고 기록할까요? 본인 신원/실제 숙지 증명이 아닙니다.",
      )
    )
      return;
    const path = `/sites/${site.id}/notices${record ? "/" + record.id : ""}${action === "save" ? "" : "/" + action}`,
      value =
        action === "save"
          ? {
              content,
              recipientIds: targets.map((t) => t.user_id),
              ...(record ? { version: record.version } : {}),
            }
          : action === "withdraw" || action === "revise"
            ? { version: record!.version, reason }
            : { version: record!.version };
    setBusy(true);
    setError("");
    try {
      const next = await api<NoticeView>(
        path,
        action === "save" && record ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      if (action === "acknowledge")
        setRecord((r) =>
          r
            ? {
                ...r,
                ownAck: next.ownAck,
                ...(r.acknowledgements && next.ownAck
                  ? {
                      acknowledgements: [
                        ...r.acknowledgements.filter(
                          (a) => a.user_id !== next.ownAck!.user_id,
                        ),
                        next.ownAck,
                      ],
                    }
                  : {}),
              }
            : next,
        );
      else adopt(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      adopt(await api<NoticeView>(`/sites/${site.id}/notices/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h1>
          공지 · {record ? noticeStatus[record.status] : "새 초안"}
        </h1>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => guard.canLeave() && onClose()}
        >
          공지 목록으로
        </button>
      </div>
      <Notice summary="지정한 계정에게만 게시됩니다. 계정 확인은 숙지·서명 증명이 아닙니다.">
        게시 대상은 명시적으로 지정한 로그인 계정입니다. 계정 확인은 근로자
        신원·숙지·서명·안전 보증이 아닙니다. 적용일은 정보 표시이며 예약 게시나
        외부 알림을 보내지 않습니다.
      </Notice>
      {record && (
        <TechDetails>
          <p>
            공지 {record.id} · 현재 버전 {record.version} · 게시본문 버전{" "}
            {record.publication?.publishedVersion || "미게시"}
          </p>
        </TechDetails>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy || !editable}>
        <label>
          공지 제목
          <input
            maxLength={200}
            value={content.title}
            onChange={(e) => setContent({ ...content, title: e.target.value })}
          />
        </label>
        <label>
          적용 작업/범위
          <textarea
            maxLength={1000}
            value={content.workScope}
            onChange={(e) =>
              setContent({ ...content, workScope: e.target.value })
            }
          />
        </label>
        <label>
          적용일 표기
          <input
            type="date"
            value={content.applyDate}
            onChange={(e) =>
              setContent({ ...content, applyDate: e.target.value })
            }
          />
        </label>
        <label>
          공지 본문
          <textarea
            maxLength={10000}
            value={content.text}
            onChange={(e) => setContent({ ...content, text: e.target.value })}
          />
        </label>
      </fieldset>
      {editable && (
        <NoticeRecipients
          key={`recipients:${record?.id || "new"}`}
          siteId={site.id}
          selected={targets}
          disabled={busy}
          onChange={setTargets}
        />
      )}
      <ActionBar note={<span role="status">{formDirty ? "저장하지 않은 입력" : record ? "서버에 저장됨" : ""}</span>}>
        {editable && (
          <button disabled={busy} onClick={() => run("save")}>
            공지 초안 저장
          </button>
        )}
        {editable && record && (
          <button disabled={busy || formDirty} onClick={() => run("publish")}>
            공지 게시
          </button>
        )}
        {record && (
          <>
            <button
              disabled={busy}
              className="secondary"
              onClick={() => open(record.id)}
            >
              최신 공지 다시 열기
            </button>
            <a
              href={`/api/sites/${site.id}/notices/${record.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              권한 범위 저장본 인쇄
            </a>
          </>
        )}
      </ActionBar>
      {record?.publication && (
        <p>
          게시 계정 {record.publication.publisher.name} (
          {record.publication.publisher.id}) · {record.publication.publishedAt}
        </p>
      )}
      {record?.ownAck ? (
        <p role="status">
          내 계정 확인: {record.ownAck.at} · 게시 버전{" "}
          {record.ownAck.published_version}
        </p>
      ) : record?.status === "published" && record.isTarget ? (
        <button disabled={busy} onClick={() => run("acknowledge")}>
          내 계정으로 공지 확인
        </button>
      ) : (
        record && (
          <p>
            현재 내 계정의 새 확인 대상이 아닙니다. 철회/대체 공지는 과거 조회만
            가능합니다.
          </p>
        )
      )}
      {manager && record?.status !== "draft" && record && (
        <section className="panel">
          <h2>관리자 수신 대상/확인 현황</h2>
          <p>
            현재 현장 manager만 전체 대상 현황을 조회합니다. 각 사용자 대신
            확인할 수 없습니다.
          </p>
          <ul>
            {(record.targets || []).map((t) => {
              const ack = record.acknowledgements?.find(
                (a) => a.user_id === t.user_id,
              );
              return (
                <li key={t.user_id}>
                  {t.name} ({t.user_id}) ·{" "}
                  {ack ? `계정 확인 ${ack.at}` : "미확인"}
                </li>
              );
            })}
          </ul>
          {record.successorId ? (
            <button disabled={busy} onClick={() => open(record.successorId!)}>
              기존 후속 공지 열기
            </button>
          ) : (
            ["published", "withdrawn"].includes(record.status) && (
              <>
                <label>
                  처리 사유
                  <textarea
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !reason.trim()}
                  onClick={() => run("revise")}
                >
                  후속 공지 초안 생성
                </button>
              </>
            )
          )}
          {record.status === "published" && (
            <>
              {record.successorId && (
                <label>
                  철회 사유
                  <textarea
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <button
                disabled={busy || !reason.trim()}
                onClick={() =>
                  window.confirm(
                    "공지의 새 확인을 중지하고 철회 상태로 남길까요? 기존 기록은 보존됩니다.",
                  ) && run("withdraw")
                }
              >
                공지 철회
              </button>
            </>
          )}
        </section>
      )}
      {manager && record && (
        <NoticeHistory
          key={`history:${record.id}`}
          siteId={site.id}
          id={record.id}
          version={record.version}
        />
      )}
    </section>
  );
}
