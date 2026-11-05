import { useEffect, useRef, useState } from "react";
import { api, uploadPhotoBoardDisplay, uploadPhotoBoardPhoto } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { makePhotoDisplay } from "./photo-display";
import { boardFor, circleAt, drawBoard, drawItem, moveCircle, moveItem, photoInfoTsv, resizeCircle, rotateItem, type Scene, type SceneItem } from "./photo-scene";
import { BOARD_MAX_ROWS, MAX_ZOOM, defaultBoard, panView, zoomView, type BoardPanel } from "../server/photo-view";
import { ActionBar, Notice, PageHeader, Section, StatusChip } from "./ui";
export type PhotoBoard = {
  id: string; title: string; version: number; updatedAt: string; body: { siteName: string; work: string; footer: string }; scene: Scene;
  photos: { id: string; filename: string; format: string; size: number; width: number | null; height: number | null; hasDisplay: boolean; createdAt: string }[];
};
type Draft = { title: string; body: PhotoBoard["body"]; scene: Scene };
const draftOf = (b: PhotoBoard): Draft => ({ title: b.title, body: b.body, scene: b.scene });
// 사진 보드(N) editor: include/order/90° rotation/zoom/caption/circle highlight with undo·redo, saved as a scene; PNG and the
// printed 사진대지 use the same geometry. Pointer drag (mouse or touch) moves a circle or pans a zoomed photo as one undo step.
export function PhotoBoardEditor({ base, initial, writable, onClose, onDirtyChange, onBusyChange }: {
  base: string; initial: PhotoBoard; writable: boolean; onClose: () => void; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void;
}) {
  const [board, setBoard] = useState(initial), [draft, setDraft] = useState<Draft>(draftOf(initial)), [past, setPast] = useState<Draft[]>([]), [future, setFuture] = useState<Draft[]>([]),
    [selected, setSelected] = useState<{ item: number; circle: number | null } | null>(null), [images, setImages] = useState<Record<string, HTMLImageElement>>({}),
    [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const saved = useRef(JSON.stringify(draftOf(initial))), dirty = JSON.stringify(draft) !== saved.current,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange), path = `${base}/${board.id}`;
  useEffect(() => {
    for (const p of board.photos) if (p.hasDisplay && !images[p.id]) {
      const img = new Image();
      img.onload = () => setImages((v) => ({ ...v, [p.id]: img }));
      img.src = `/api${path}/photos/${p.id}/display`;
    }
  }, [board.photos, images, path]);
  function change(next: Draft) { setPast((v) => [...v.slice(-49), draft]); setFuture([]); setDraft(next); }
  const setItems = (items: SceneItem[]) => change({ ...draft, scene: { ...draft.scene, items } });
  const setItem = (i: number, item: SceneItem) => setItems(draft.scene.items.map((x, j) => (j === i ? item : x)));
  function undo() { if (!past.length) return; setFuture((v) => [draft, ...v]); setDraft(past[past.length - 1]); setPast((v) => v.slice(0, -1)); }
  function redo() { if (!future.length) return; setPast((v) => [...v, draft]); setDraft(future[0]); setFuture((v) => v.slice(1)); }
  async function upload(picked: File[]) {
    // A folder may hold anything: only PNG/JPEG go up, and never past the 40-photo board limit (the rest is reported, not dropped silently).
    const images = picked.filter((f) => /\.(png|jpe?g)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, "ko")), room = Math.max(0, 40 - board.photos.length), files = images.slice(0, room);
    const skipped = picked.length - files.length;
    setBusy(true); setError(""); setNotice(skipped ? `${files.length}장을 올립니다. ${skipped}개는 건너뜀(PNG·JPEG가 아니거나 보드당 40장 초과).` : "");
    let current = board, items = draft.scene.items;
    try {
      for (const file of files) {
        const photoPath = `${path}/photos`,
          r = await uploadPhotoBoardPhoto<{ photoId: string; board: PhotoBoard }>(photoPath, file, current.version, guard.key(photoPath, { v: current.version, f: [file.name, file.size, file.lastModified] }));
        current = r.board;
        try {
          const displayPath = `${path}/photos/${r.photoId}/display`;
          current = await uploadPhotoBoardDisplay<PhotoBoard>(displayPath, await makePhotoDisplay(file), current.version, guard.key(displayPath, { id: r.photoId }));
        } catch (e) { setError(`${file.name}: 원본은 저장했습니다. 표시본: ${(e as Error).message}`); }
        items = [...items, { photoId: r.photoId, included: true, rotation: 0, caption: "", circles: [] }];
      }
    } catch (e) { setError((e as Error).message); }
    setBoard(current);
    if (items !== draft.scene.items) change({ ...draft, scene: { ...draft.scene, items } });
    setBusy(false);
  }
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = { version: board.version, ...draft }, next = await api<PhotoBoard>(path, "PUT", body, guard.key(path, body));
      setBoard(next); saved.current = JSON.stringify(draftOf(next)); setDraft(draftOf(next)); setNotice("저장했습니다.");
    } catch (e) { setError((e as Error).message + " 입력은 유지됩니다."); } finally { setBusy(false); }
  }
  function exportTsv() {
    const rows = [["순번", "파일명", "포함", "회전", "확대", "설명", "강조 수"], ...draft.scene.items.map((item, i) => [
      String(i + 1), board.photos.find((p) => p.id === item.photoId)?.filename ?? "", item.included ? "포함" : "제외", `${item.rotation}°`, `${item.view?.zoom ?? 1}배`, item.caption, String(item.circles.length)])];
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([photoInfoTsv(rows)], { type: "text/tab-separated-values;charset=utf-8" }));
    a.download = `${draft.title || "사진 보드"} 사진 정보표.tsv`; a.click(); URL.revokeObjectURL(a.href);
    setNotice(`사진 정보표 ${draft.scene.items.length}행을 저장했습니다.`);
  }
  function exportPng() {
    const shown = draft.scene.items.filter((i) => i.included && images[i.photoId]);
    if (!shown.length) { setError("포함된 사진이 없어 PNG를 만들 수 없습니다."); return; }
    const W = 1600, cell = 700, head = 220, cols = 2, rows = Math.ceil(shown.length / cols), H = head + rows * (cell + 80) + 120;
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#111"; ctx.textBaseline = "top";
    ctx.font = "bold 56px sans-serif"; ctx.fillText(draft.title, 60, 50, W - 120);
    ctx.font = "32px sans-serif"; ctx.fillText([draft.body.siteName, draft.body.work].filter(Boolean).join(" · "), 60, 130, W - 120);
    shown.forEach((item, i) => {
      const x = 60 + (i % cols) * (cell + 80), y = head + Math.floor(i / cols) * (cell + 80);
      const r = drawItem(ctx, images[item.photoId], item, { x, y, w: cell, h: cell }), b = boardFor(draft.scene, item);
      if (b) drawBoard(ctx, b, r);
      ctx.fillStyle = "#111"; ctx.font = "30px sans-serif"; ctx.fillText(item.caption, x, y + cell + 16, cell);
    });
    ctx.font = "28px sans-serif"; ctx.fillText(draft.body.footer, 60, H - 80, W - 120);
    canvas.toBlob((blob) => {
      if (!blob) { setError("PNG를 만들지 못했습니다. 편집 내용은 그대로입니다."); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${draft.title || "사진 보드"}.png`; a.click(); URL.revokeObjectURL(a.href);
      setNotice(`PNG ${shown.length}장 보드를 만들었습니다.`);
    }, "image/png");
  }
  const placed = new Set(draft.scene.items.map((i) => i.photoId)), unplaced = board.photos.filter((p) => !placed.has(p.id));
  return <section className="panel photo-editor">
    <PageHeader back="사진 보드 목록으로" backDisabled={busy} onBack={() => { if (guard.canLeave()) onClose(); }} title={draft.title || "사진 보드"}
      status={dirty ? <StatusChip tone="pending">저장 안 됨</StatusChip> : <StatusChip tone="done">저장됨</StatusChip>}>
      <button className="secondary" disabled={busy} onClick={exportPng}>PNG 저장</button>
      <button className="secondary" disabled={busy || !draft.scene.items.length} onClick={exportTsv}>사진 정보표 TSV 저장</button>
      <a className="button secondary" href={`/api${path}/print`} target="_blank" rel="noreferrer">사진대지 인쇄 / PDF</a>
    </PageHeader>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={!writable || busy}>
      <Section no={1} level={3} title="보드 정보">
      <div className="grid">
      <label>제목<input maxLength={200} value={draft.title} onChange={(e) => change({ ...draft, title: e.target.value })} /></label>
      <label>현장명<input maxLength={200} value={draft.body.siteName} onChange={(e) => change({ ...draft, body: { ...draft.body, siteName: e.target.value } })} /></label>
      <label>작업내용<input maxLength={500} value={draft.body.work} onChange={(e) => change({ ...draft, body: { ...draft.body, work: e.target.value } })} /></label>
      <label>하단 정보<input maxLength={500} value={draft.body.footer} onChange={(e) => change({ ...draft, body: { ...draft.body, footer: e.target.value } })} /></label>
      </div>
      </Section>
      <Section no={2} level={3} title={`사진 · ${board.photos.length}/40장`}>
      <div className="grid">
      <label>사진 추가(PNG·JPEG, 원본 보존)<input type="file" multiple accept=".png,.jpg,.jpeg" onChange={(e) => { if (e.target.files?.length) void upload(Array.from(e.target.files)); e.target.value = ""; }} /></label>
      <label>폴더 추가(안의 PNG·JPEG만)<input type="file" multiple {...{ webkitdirectory: "" }} onChange={(e) => { if (e.target.files?.length) void upload(Array.from(e.target.files)); e.target.value = ""; }} /></label>
      </div>
      </Section>
      <Section no={3} level={3} title="보드판">
      <p className="muted">사진 위에 항목·내용 표를 얹습니다. 원본 사진은 그대로 두고 미리보기·PNG·사진대지 인쇄에만 그립니다.</p>
      <label><input type="checkbox" checked={!!draft.scene.board} onChange={(e) => { const scene = { ...draft.scene }; if (e.target.checked) scene.board = defaultBoard(); else delete scene.board; change({ ...draft, scene }); }} />모든 사진에 보드판 넣기</label>
      {draft.scene.board && <BoardFields name="보드판" value={draft.scene.board} onChange={(board) => change({ ...draft, scene: { ...draft.scene, board } })} />}
      </Section>
    </fieldset>
    {unplaced.length > 0 && <p>배치 안 된 사진: {unplaced.map((p) => <button key={p.id} className="secondary" disabled={!writable || busy} onClick={() => setItems([...draft.scene.items, { photoId: p.id, included: true, rotation: 0, caption: "", circles: [] }])}>{p.filename} 배치</button>)}</p>}
    {draft.scene.items.length > 0 && <Notice summary="사진을 누르면 원형 강조가 생깁니다. 끌어서 옮깁니다.">사진을 누르면 그 자리에 원형 강조가 생깁니다. 강조는 끌어서 옮기고(손가락도 가능), 고른 뒤 화살표(Shift는 10배)·+/−·Delete 또는 아래 버튼으로 조정합니다. 확대한 사진은 빈 곳을 끌어 보이는 위치를 옮깁니다.</Notice>}
    <ol className="photo-items">
      {draft.scene.items.map((item, i) => {
        const photo = board.photos.find((p) => p.id === item.photoId);
        return <li key={item.photoId} className="photo-item" data-included={item.included}>
          <ItemCanvas img={images[item.photoId]} item={item} board={boardFor(draft.scene, item)} label={`${i + 1}번 사진 ${photo?.filename ?? ""}`} selectedCircle={selected?.item === i ? selected.circle : null} writable={writable && !busy}
            onAdd={(x, y) => { if (!writable) return; setItem(i, { ...item, circles: [...item.circles, { x, y, r: 0.08, color: "red" as const }].slice(0, 10) }); setSelected({ item: i, circle: Math.min(item.circles.length, 9) }); }}
            onSelect={(c) => setSelected({ item: i, circle: c })} onCommit={(next) => setItem(i, next)}
            onKey={(e) => {
              const c = selected?.item === i ? selected.circle : null;
              if (!writable || c === null || !item.circles[c]) return;
              const step = e.shiftKey ? 0.1 : 0.01, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
              if (mv) setItem(i, { ...item, circles: item.circles.map((x, j) => (j === c ? moveCircle(x, mv[0], mv[1]) : x)) });
              else if (e.key === "+" || e.key === "-") setItem(i, { ...item, circles: item.circles.map((x, j) => (j === c ? resizeCircle(x, e.key === "+" ? 0.01 : -0.01) : x)) });
              else if (e.key === "Delete") { setItem(i, { ...item, circles: item.circles.filter((_, j) => j !== c) }); setSelected(null); }
              else return;
              e.preventDefault();
            }} />
          {!photo?.hasDisplay && <p>표시본이 없어 미리보기·PNG에서 빠집니다.</p>}
          <fieldset disabled={!writable || busy}>
            <label><input type="checkbox" checked={item.included} onChange={(e) => setItem(i, { ...item, included: e.target.checked })} />포함</label>
            <button className="secondary" onClick={() => setItems(moveItem(draft.scene.items, i, -1))} disabled={i === 0}>위로</button>
            <button className="secondary" onClick={() => setItems(moveItem(draft.scene.items, i, 1))} disabled={i === draft.scene.items.length - 1}>아래로</button>
            <button className="secondary" onClick={() => setItem(i, rotateItem(item))}>90° 회전</button>
            <label>확대(배) <input type="range" min={1} max={MAX_ZOOM} step={0.25} value={item.view?.zoom ?? 1} onChange={(e) => { const view = zoomView(item.view, Number(e.target.value)), next: SceneItem = { ...item }; delete next.view; setItem(i, view ? { ...next, view } : next); }} /> {item.view?.zoom ?? 1}배</label>
            <label>설명<input maxLength={200} value={item.caption} onChange={(e) => setItem(i, { ...item, caption: e.target.value })} /></label>
            <label>보드판<select aria-label={`${i + 1}번 사진 보드판 적용`} value={item.board === null ? "none" : item.board ? "own" : "common"} onChange={(e) => {
              const next: SceneItem = { ...item }, v = e.target.value;
              if (v === "common") delete next.board; else next.board = v === "none" ? null : structuredClone(draft.scene.board ?? defaultBoard());
              setItem(i, next);
            }}><option value="common">{draft.scene.board ? "공통 보드판" : "없음(공통 꺼짐)"}</option><option value="own">이 사진만 따로</option><option value="none">이 사진은 빼기</option></select></label>
            {item.board && <details open><summary>{i + 1}번 사진 보드판</summary><BoardFields name={`${i + 1}번 사진 보드판`} value={item.board} onChange={(board) => setItem(i, { ...item, board })} /></details>}
            {item.circles.map((c, j) => <button className="secondary" key={j} aria-pressed={selected?.item === i && selected.circle === j} onClick={() => setSelected({ item: i, circle: j })}>강조 {j + 1}</button>)}
            {selected?.item === i && selected.circle !== null && item.circles[selected.circle] && <>
              <button className="secondary" onClick={() => setItem(i, { ...item, circles: item.circles.map((x, j) => (j === selected.circle ? resizeCircle(x, 0.02) : x)) })}>강조 크게</button>
              <button className="secondary" onClick={() => setItem(i, { ...item, circles: item.circles.map((x, j) => (j === selected.circle ? resizeCircle(x, -0.02) : x)) })}>강조 작게</button>
              <button className="secondary" onClick={() => { setItem(i, { ...item, circles: item.circles.filter((_, j) => j !== selected.circle) }); setSelected(null); }}>강조 삭제</button>
            </>}
            {selected?.item === i && selected.circle !== null && item.circles[selected.circle] && <label>강조 색<select value={item.circles[selected.circle].color} onChange={(e) => setItem(i, { ...item, circles: item.circles.map((x, j) => (j === selected.circle ? { ...x, color: e.target.value as "red" } : x)) })}><option value="red">빨강</option><option value="yellow">노랑</option><option value="blue">파랑</option></select></label>}
            <a className="button secondary" href={`/api${path}/photos/${item.photoId}/download`}>원본 다운로드</a>
          </fieldset>
        </li>;
      })}
    </ol>
    <ActionBar note={dirty ? "인쇄는 저장된 내용 기준입니다. 먼저 저장하세요." : undefined}>
      <button disabled={!writable || busy || !dirty || !draft.title.trim()} onClick={() => void save()}>사진 보드 저장</button>
      <button className="secondary" disabled={!writable || busy || !past.length} onClick={undo}>실행 취소</button>
      <button className="secondary" disabled={!writable || busy || !future.length} onClick={redo}>다시 실행</button>
    </ActionBar>
  </section>;
}
const CORNERS = [["tl", "왼쪽 위"], ["tr", "오른쪽 위"], ["bl", "왼쪽 아래"], ["br", "오른쪽 아래"]] as const;
// 보드판 fields; `name` prefixes every label so the common board and a photo's own board stay distinguishable.
function BoardFields({ name, value: b, onChange }: { name: string; value: BoardPanel; onChange: (b: BoardPanel) => void }) {
  const set = (p: Partial<BoardPanel>) => onChange({ ...b, ...p });
  const setRow = (i: number, p: Partial<BoardPanel["rows"][number]>) => set({ rows: b.rows.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  return <div className="board-fields">
    <table className="board-rows"><thead><tr><th scope="col">항목</th><th scope="col">내용</th><th scope="col"><span className="sr-only">줄 삭제</span></th></tr></thead><tbody>
      {b.rows.map((r, i) => <tr key={i}>
        <td><input aria-label={`${name} ${i + 1}줄 항목`} maxLength={20} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} /></td>
        <td><input aria-label={`${name} ${i + 1}줄 내용`} maxLength={200} value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} /></td>
        <td><button type="button" className="secondary" disabled={b.rows.length <= 1} aria-label={`${name} ${i + 1}줄 삭제`} onClick={() => set({ rows: b.rows.filter((_, j) => j !== i) })}>삭제</button></td>
      </tr>)}
    </tbody></table>
    <p><button type="button" className="secondary" disabled={b.rows.length >= BOARD_MAX_ROWS} onClick={() => set({ rows: [...b.rows, { label: "", value: "" }] })}>{name} 줄 추가</button> <span className="muted">최대 {BOARD_MAX_ROWS}줄</span></p>
    <div className="segmented" role="group" aria-label={`${name} 위치`}>
      {CORNERS.map(([v, l]) => <button type="button" key={v} aria-pressed={b.corner === v} className={b.corner === v ? "" : "secondary"} onClick={() => set({ corner: v })}>{l}</button>)}
    </div>
    <div className="grid">
      <label>{name} 크기 <input type="range" aria-label={`${name} 크기`} min={0.2} max={1} step={0.05} value={b.size} onChange={(e) => set({ size: Number(e.target.value) })} /> {Math.round(b.size * 100)}%</label>
      <label>{name} 바탕 진하기 <input type="range" aria-label={`${name} 바탕 진하기`} min={0.2} max={1} step={0.05} value={b.opacity} onChange={(e) => set({ opacity: Number(e.target.value) })} /> {Math.round(b.opacity * 100)}%</label>
      <label>{name} 색<select aria-label={`${name} 색`} value={b.theme} onChange={(e) => set({ theme: e.target.value as BoardPanel["theme"] })}><option value="white">흰 보드</option><option value="green">녹색 칠판</option><option value="black">검은 보드</option></select></label>
      <label>{name} 항목 정렬<select aria-label={`${name} 항목 정렬`} value={b.labelAlign} onChange={(e) => set({ labelAlign: e.target.value as "left" })}><option value="center">가운데</option><option value="left">왼쪽</option></select></label>
      <label>{name} 내용 정렬<select aria-label={`${name} 내용 정렬`} value={b.valueAlign} onChange={(e) => set({ valueAlign: e.target.value as "left" })}><option value="left">왼쪽</option><option value="center">가운데</option></select></label>
      <label><input type="checkbox" checked={b.bold} onChange={(e) => set({ bold: e.target.checked })} />{name} 글자 굵게</label>
    </div>
  </div>;
}
export function ItemCanvas({ img, item, board, label, selectedCircle, writable, onAdd, onSelect, onCommit, onKey }: {
  img?: HTMLImageElement; item: SceneItem; board?: BoardPanel; label: string; selectedCircle: number | null; writable: boolean;
  onAdd: (x: number, y: number) => void; onSelect: (circle: number) => void; onCommit: (item: SceneItem) => void; onKey: (e: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null), rect = useRef({ x: 0, y: 0, w: 0, h: 0, ox: 0, oy: 0, fw: 0, fh: 0 }), [live, setLive] = useState<SceneItem | null>(null);
  // One drag = one change: the preview follows the pointer locally and the parent gets the result once, on release.
  const drag = useRef<{ kind: "circle" | "pan" | "tap"; index: number; sx: number; sy: number; fw: number; fh: number; px: number; py: number; moved: boolean } | null>(null);
  const shown = live ?? item;
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#f4f4f4"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    const r = (rect.current = drawItem(ctx, img, shown, { x: 0, y: 0, w: canvas.width, h: canvas.height }));
    if (board) drawBoard(ctx, board, r);
    const c = selectedCircle !== null ? shown.circles[selectedCircle] : undefined;
    if (c) { const d = c.r * Math.min(r.fw, r.fh); ctx.setLineDash([6, 4]); ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(r.ox + c.x * r.fw - d, r.oy + c.y * r.fh - d, d * 2, d * 2); ctx.setLineDash([]); }
  }, [img, shown, selectedCircle, board]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect(), sx = e.currentTarget.width / box.width, sy = e.currentTarget.height / box.height;
    return { cx: (e.clientX - box.left) * sx, cy: (e.clientY - box.top) * sy };
  };
  return <canvas ref={ref} width={480} height={360} tabIndex={0} role="img" aria-label={`${label} 미리보기${img ? "" : "(불러오는 중)"}, 원형 강조 ${shown.circles.length}개${shown.view ? `, ${shown.view.zoom}배 확대` : ""}${board ? `, 보드판 ${board.rows.length}줄` : ""}`}
    style={{ maxWidth: "100%", cursor: "crosshair", touchAction: writable ? "none" : "auto" }}
    onKeyDown={onKey}
    onPointerDown={(e) => {
      const r = rect.current;
      if (!writable || !img || !r.fw) return;
      const { cx, cy } = point(e);
      if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h) return;
      const px = (cx - r.ox) / r.fw, py = (cy - r.oy) / r.fh, hit = circleAt(item, px, py, r.fw, r.fh);
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: hit >= 0 ? "circle" : item.view ? "pan" : "tap", index: hit, sx: cx, sy: cy, fw: r.fw, fh: r.fh, px, py, moved: false };
      if (hit >= 0) onSelect(hit);
    }}
    onPointerMove={(e) => {
      const d = drag.current;
      if (!d) return;
      const { cx, cy } = point(e), dx = (cx - d.sx) / d.fw, dy = (cy - d.sy) / d.fh;
      if (!d.moved && Math.hypot(cx - d.sx, cy - d.sy) < 4) return;
      d.moved = true;
      if (d.kind === "circle") setLive({ ...item, circles: item.circles.map((c, j) => (j === d.index ? moveCircle(c, dx, dy) : c)) });
      else if (d.kind === "pan" && item.view) setLive({ ...item, view: panView(item.view, -dx, -dy) });
    }}
    onPointerUp={() => {
      const d = drag.current;
      drag.current = null;
      if (d && d.moved && live) onCommit(live);
      else if (d && !d.moved && d.index < 0) onAdd(Math.round(d.px * 1000) / 1000, Math.round(d.py * 1000) / 1000);
      setLive(null);
    }}
    onPointerCancel={() => { drag.current = null; setLive(null); }} />;
}
