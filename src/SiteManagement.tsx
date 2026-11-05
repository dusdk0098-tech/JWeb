import { useEffect, useRef, useState } from "react";
import { SiteJoinLinks } from "./SiteJoinLinks";
import { api, type Site, type User } from "./api";
export function SiteManagement({
  site,
  refresh,
  issuer = false,
}: {
  sites: Site[];
  site: Site | undefined;
  refresh: () => Promise<void>;
  issuer?: boolean; // 계정 발급 권한 (운영자가 줌): this manager may create accounts for this site
}) {
  const [reset, setReset] = useState<string | null>(null);
  const [members, setMembers] = useState<(User & { role: string })[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const createKey = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    setMembers([]);
    setError("");
    if (site?.role === "manager")
      api<(User & { role: string })[]>(`/sites/${site.id}/members`)
        .then((r) => {
          if (active) setMembers(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [site]);
  async function run(task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">SITE SETTINGS</p>
        <h1>현장 관리</h1>
        <p>계정은 별도 CLI로 발급하며, 현장 접근은 여기서 배정합니다.</p>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>새 현장</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/sites", "POST", { name: newName }, createKey.current);
              setNewName("");
              createKey.current = crypto.randomUUID();
            });
          }}
        >
          <label>
            현장 이름
            <input
              required
              maxLength={200}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                createKey.current = crypto.randomUUID();
              }}
            />
          </label>
          <button disabled={busy}>현장 만들기</button>
        </form>
      </section>
      {site && (
        <section className="panel">
          <h2>{site.name}</h2>
          {site.role !== "manager" ? (
            <p>현장 관리자만 이름과 구성원을 관리할 수 있습니다.</p>
          ) : (
            <>
              <form
                key={site.id + site.version}
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(() =>
                    api(
                      `/sites/${site.id}`,
                      "PATCH",
                      { name: data.get("name"), version: site.version },
                      crypto.randomUUID(),
                    ),
                  );
                }}
              >
                <label>
                  현장 이름 변경
                  <input
                    name="name"
                    required
                    maxLength={200}
                    defaultValue={site.name}
                  />
                </label>
                <button disabled={busy} className="secondary">
                  이름 저장
                </button>
              </form>
              <h3>구성원</h3>
              <ul className="members">
                {members.map((m) => (
                  <li key={m.id}>
                    <span>
                      {m.name} · {m.email}
                      <small>{m.role}</small>
                    </span>
                    {issuer && m.role !== "manager" && !m.email.startsWith("근로자 · ") && (
                      <button type="button" disabled={busy} className="secondary" onClick={() => setReset(reset === m.id ? null : m.id)}>
                        비밀번호 초기화
                      </button>
                    )}
                    {reset === m.id && (
                      <form className="inline-create" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void run(() => api(`/sites/${site.id}/accounts/${m.id}/password`, "POST", { password: d.get("password") }, crypto.randomUUID()).then(() => setReset(null))); }}>
                        <label>새 비밀번호 (12자 이상)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
                        <button disabled={busy}>초기화 · 기존 로그인 끊김</button>
                      </form>
                    )}
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() => {
                        if (confirm(`${m.name} 님의 현장 접근을 해제할까요?`))
                          void run(() =>
                            api(
                              `/sites/${site.id}/members/${m.id}`,
                              "DELETE",
                              undefined,
                              crypto.randomUUID(),
                            ),
                          );
                      }}
                    >
                      접근 해제
                    </button>
                  </li>
                ))}
              </ul>
              <SiteJoinLinks siteId={site.id} />
              {issuer && (
                <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget, d = new FormData(f); void run(() => api(`/sites/${site.id}/accounts`, "POST", { name: d.get("name"), email: d.get("email"), password: d.get("password"), role: d.get("role") }, crypto.randomUUID()).then(() => f.reset())); }}>
                  <fieldset disabled={busy}>
                    <legend>이 현장에 새 계정 발급</legend>
                    <div className="grid">
                      <label>이름<input name="name" required maxLength={100} /></label>
                      <label>이메일<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
                      <label>첫 비밀번호 (12자 이상)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
                      <label>권한<select name="role" defaultValue="editor"><option value="viewer">열람자</option><option value="editor">작성자</option><option value="manager">현장 관리자</option></select></label>
                    </div>
                    <p className="muted">첫 비밀번호는 직접 전달하고, 받은 사람이 "내 비밀번호"에서 바꾸게 하세요. 발급 기록이 남습니다.</p>
                    <button>계정 만들고 이 현장에 추가</button>
                  </fieldset>
                </form>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void run(() =>
                    api(
                      `/sites/${site.id}/members`,
                      "PUT",
                      { email: data.get("email"), role: data.get("role") },
                      crypto.randomUUID(),
                    ),
                  );
                }}
              >
                <div className="grid">
                  <label>
                    기존 계정 이메일
                    <input name="email" type="email" required maxLength={254} />
                  </label>
                  <label>
                    권한
                    <select name="role" defaultValue="viewer">
                      <option value="viewer">열람자 · 보기/인쇄</option>
                      <option value="editor">작성자 · 보기/작성/수정</option>
                      <option value="manager">
                        현장 관리자 · 구성원/현장 관리 포함
                      </option>
                    </select>
                  </label>
                </div>
                <button disabled={busy}>구성원 추가 / 권한 변경</button>
              </form>
              <p className="muted">
                마지막 관리자는 해제하거나 권한을 낮출 수 없습니다. 모든 변경은
                서버 권한 검사와 감사 이력에 기록됩니다.
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}
