import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
import type { NoticeTarget } from "./notice-types";
export function NoticeRecipients({
  siteId,
  selected,
  disabled,
  onChange,
}: {
  siteId: string;
  selected: NoticeTarget[];
  disabled: boolean;
  onChange: (v: NoticeTarget[]) => void;
}) {
  const [page, setPage] = useState<
      Page<{ id: string; name: string; role: string }>
    >({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<{ id: string; name: string; role: string }>>(
      `/sites/${siteId}/notices/recipients?offset=${offset}`,
    )
      .then((r) => {
        if (active) setPage(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [siteId, offset]);
  return (
    <fieldset disabled={disabled}>
      <legend>명시적 수신 계정 (1–200명)</legend>
      <p>
        근로자 명부와 별개인 로그인 계정입니다. 신규 가입자는 자동 추가하지
        않습니다. 과거 대상의 권한이 없어졌다면 제거/대체 후 게시하세요.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul>
        {selected.map((t) => (
          <li key={t.user_id}>
            {t.name} ({t.user_id}){" "}
            <button
              className="secondary"
              onClick={() =>
                onChange(selected.filter((v) => v.user_id !== t.user_id))
              }
            >
              이 수신 계정 제거
            </button>
          </li>
        ))}
      </ul>
      {loading ? (
        <p>계정 조회 중…</p>
      ) : (
        page.items.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={selected.some((t) => t.user_id === p.id)}
              disabled={
                !selected.some((t) => t.user_id === p.id) &&
                selected.length >= 200
              }
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, { user_id: p.id, name: p.name }]
                    : selected.filter((t) => t.user_id !== p.id),
                )
              }
            />
            {p.name} · {p.role} ({p.id})
          </label>
        ))
      )}
      <button
        disabled={loading || !offset}
        onClick={() => setOffset(offset - 50)}
      >
        이전 50
      </button>
      <button
        disabled={loading || !page.hasMore}
        onClick={() => setOffset(offset + 50)}
      >
        다음 50
      </button>
    </fieldset>
  );
}
