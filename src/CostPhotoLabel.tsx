import { useEffect, useState } from "react";
import { api } from "./api";
import { photoGroups } from "../server/cost-photo-schema";
import { ItemCanvas } from "./PhotoBoardEditor";
import { resizeCircle, rotateItem, type Circle, type SceneItem } from "./photo-scene";
export type PhotoLabel = {
  attachmentId: string; filename: string; groupName: string; takenDate: string; description: string; included: boolean; labelVersion: number;
  width: number; height: number; rotation: 0 | 90 | 180 | 270; circles: Circle[]; position: number | null;
};
type Form = Pick<PhotoLabel, "groupName" | "takenDate" | "description" | "included" | "rotation" | "circles">;
const formOf = (p: PhotoLabel): Form => ({ groupName: p.groupName, takenDate: p.takenDate, description: p.description, included: p.included, rotation: p.rotation, circles: p.circles });
// SC 사진대지 항목: the original photo form (분류·촬영일·내용), 포함 instead of delete (originals are retained), and — 보완 —
// 90° rotation and circle highlights drawn by the same canvas as the photo board, with undo/redo until saved.
export function CostPhotoLabel({ base, photo, open, disabled, onSaved, onDirty, keyFor, onMove, first, last, moveLocked }: {
  base: string; photo: PhotoLabel; open: boolean; disabled: boolean; onSaved: () => void; onDirty: (id: string, v: boolean) => void; keyFor: (path: string, body: unknown) => string;
  onMove: (delta: -1 | 1) => void; first: boolean; last: boolean; moveLocked: boolean;
}) {
  const [form, setForm] = useState<Form>(formOf(photo)), [past, setPast] = useState<Form[]>([]), [future, setFuture] = useState<Form[]>([]),
    [busy, setBusy] = useState(false), [error, setError] = useState(""), [img, setImg] = useState<HTMLImageElement>(), [selected, setSelected] = useState<number | null>(null);
  // loaded = the version this form was opened from: a refresh must not swap it under typed input, and a stale save gets the server's 409.
  const [loaded, setLoaded] = useState(photo);
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(loaded)), writable = open && !disabled && !busy;
  if (!dirty && photo.labelVersion !== loaded.labelVersion) { setLoaded(photo); setForm(formOf(photo)); setPast([]); setFuture([]); }
  useEffect(() => { onDirty(photo.attachmentId, dirty); }, [photo.attachmentId, dirty, onDirty]);
  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = `/api${base}/evidence/files/${photo.attachmentId}/display`;
  }, [base, photo.attachmentId]);
  const change = (next: Form) => { setPast((v) => [...v.slice(-49), form]); setFuture([]); setForm(next); };
  const scene: SceneItem = { photoId: photo.attachmentId, included: form.included, rotation: form.rotation, caption: form.description, circles: form.circles };
  const setScene = (s: SceneItem) => change({ ...form, rotation: s.rotation, circles: s.circles });
  async function save() {
    setBusy(true); setError("");
    const path = base + `/evidence/files/${photo.attachmentId}/display/label`, body = { labelVersion: loaded.labelVersion, ...form };
    try {
      const fresh = (await api<{ photos: PhotoLabel[] }>(path, "PUT", body, keyFor(path, body))).photos.find((p) => p.attachmentId === photo.attachmentId);
      if (fresh) { setLoaded(fresh); setForm(formOf(fresh)); setPast([]); setFuture([]); }
      onDirty(photo.attachmentId, false); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <fieldset disabled={!open || disabled || busy}><legend>사진대지 항목</legend>
    {error && <p role="alert">{error} 입력은 유지됩니다.</p>}
    <ItemCanvas img={img} item={scene} label={`${photo.filename}`} selectedCircle={selected} writable={writable}
      onAdd={(x, y) => { setScene({ ...scene, circles: [...scene.circles, { x, y, r: 0.08, color: "red" as const }].slice(0, 10) }); setSelected(Math.min(scene.circles.length, 9)); }}
      onSelect={setSelected} onCommit={setScene} onKey={() => {}} />
    <button onClick={() => setScene(rotateItem(scene))}>90° 회전</button>
    {selected !== null && form.circles[selected] && <>
      <button onClick={() => setScene({ ...scene, circles: scene.circles.map((c, j) => (j === selected ? resizeCircle(c, 0.02) : c)) })}>강조 크게</button>
      <button onClick={() => setScene({ ...scene, circles: scene.circles.map((c, j) => (j === selected ? resizeCircle(c, -0.02) : c)) })}>강조 작게</button>
      <button onClick={() => { setScene({ ...scene, circles: scene.circles.filter((_, j) => j !== selected) }); setSelected(null); }}>강조 삭제</button>
    </>}
    <button disabled={!past.length} onClick={() => { setFuture((v) => [form, ...v]); setForm(past[past.length - 1]); setPast((v) => v.slice(0, -1)); }}>실행 취소</button>
    <button disabled={!future.length} onClick={() => { setPast((v) => [...v, form]); setForm(future[0]); setFuture((v) => v.slice(1)); }}>다시 실행</button>
    <label>분류<select value={form.groupName} onChange={e => change({ ...form, groupName: e.target.value })}>{photoGroups.map(g => <option key={g}>{g}</option>)}</select></label>
    <label>촬영일<input type="date" value={form.takenDate} onChange={e => change({ ...form, takenDate: e.target.value })}/></label>
    <label>내용<input maxLength={200} value={form.description} onChange={e => change({ ...form, description: e.target.value })}/></label>
    <label><input type="checkbox" checked={form.included} onChange={e => change({ ...form, included: e.target.checked })}/>사진대지에 포함</label>
    <button disabled={!dirty} onClick={() => void save()}>사진대지 항목 저장</button>
    <button disabled={dirty || first || moveLocked} onClick={() => onMove(-1)}>분류 안에서 위로</button>
    <button disabled={dirty || last || moveLocked} onClick={() => onMove(1)}>분류 안에서 아래로</button>
  </fieldset>;
}
