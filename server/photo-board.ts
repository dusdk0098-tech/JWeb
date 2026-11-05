import type { Express, Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { rawAttachmentMetadata, checkRawImageHeader, recheckUploadSession } from "./raw-attachment.js";
import { attachmentUsage, enforceAttachmentQuota } from "./attachment-quota.js";
import { sendAttachment, type boundedUploadReader } from "./bounded-upload.js";
import { imageSize, PHOTO_DISPLAY_MAX_BYTES, PHOTO_DISPLAY_MAX_SIDE } from "./image-size.js";
import { BOARD_MAX_ROWS, BOARD_THEMES, MAX_ZOOM, photoSvg } from "./photo-view.js";
import { escapeHtml as e } from "./print.js";
// 사진 보드(N) 1단계 (사진 정책 A안): originals kept as download-only bytes; only the browser-made EXIF-free JPEG is shown.
// The scene (order, include, 90° rotation, caption, circle highlights in normalized coordinates) is stored apart from photos.
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migratePhotoBoards(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS photo_boards(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),title TEXT NOT NULL,body TEXT NOT NULL,scene TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>=1),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS photo_boards_site ON photo_boards(site_id,updated_at);
 CREATE TABLE IF NOT EXISTS photo_board_photos(id TEXT PRIMARY KEY,board_id TEXT NOT NULL REFERENCES photo_boards(id),site_id TEXT NOT NULL REFERENCES sites(id),
  filename TEXT NOT NULL,format TEXT NOT NULL CHECK(format IN('image/png','image/jpeg')),size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 TEXT NOT NULL,
  bytes BLOB NOT NULL CHECK(length(bytes)=size),width INTEGER,height INTEGER,display_size INTEGER CHECK(display_size BETWEEN 1 AND 1048576),display_sha256 TEXT,display BLOB,
  created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS photo_board_photos_board ON photo_board_photos(board_id,created_at);
 CREATE INDEX IF NOT EXISTS photo_board_photos_site ON photo_board_photos(site_id);
 CREATE TRIGGER IF NOT EXISTS photo_board_photo_display_once BEFORE UPDATE ON photo_board_photos WHEN
  OLD.display IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.board_id IS NOT OLD.board_id OR NEW.site_id IS NOT OLD.site_id OR NEW.filename IS NOT OLD.filename OR
  NEW.format IS NOT OLD.format OR NEW.size IS NOT OLD.size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Photo original fixed; display set once'); END;
 CREATE TRIGGER IF NOT EXISTS photo_board_photo_retained BEFORE DELETE ON photo_board_photos BEGIN SELECT RAISE(ABORT,'Photo original retained'); END;
 PRAGMA user_version=62;
`);
}
export const PHOTO_BOARD_MAX_PHOTOS = 40;
const text = (max: number) => z.string().trim().max(max);
const circle = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), r: z.number().min(0.01).max(0.5), color: z.enum(["red", "yellow", "blue"]) }).strict();
// 보드판 (docs/PHOTO_BOARD_FRANVIEW_ANALYSIS.md): optional; older saved scenes stay valid.
const boardPanel = z.object({
  rows: z.array(z.object({ label: text(20), value: text(200) }).strict()).min(1).max(BOARD_MAX_ROWS),
  corner: z.enum(["tl", "tr", "bl", "br"]), size: z.number().min(0.2).max(1),
  theme: z.enum(Object.keys(BOARD_THEMES) as [keyof typeof BOARD_THEMES, ...(keyof typeof BOARD_THEMES)[]]), opacity: z.number().min(0.2).max(1),
  bold: z.boolean(), labelAlign: z.enum(["left", "center"]), valueAlign: z.enum(["left", "center"]),
}).strict();
export const photoScene = z.object({
  layoutVersion: z.literal(1),
  board: boardPanel.optional(),
  items: z.array(z.object({
    photoId: z.uuid(), included: z.boolean(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    caption: text(200), circles: z.array(circle).max(10),
    // 2단계: optional zoom view over the rotated photo (absent = whole photo); older saved scenes stay valid.
    view: z.object({ zoom: z.number().min(1).max(MAX_ZOOM), cx: z.number().min(0).max(1), cy: z.number().min(0).max(1) }).strict().optional(),
    board: boardPanel.nullable().optional(), // undefined = the common 보드판, null = none on this photo
  }).strict()).max(PHOTO_BOARD_MAX_PHOTOS),
}).strict();
const boardBody = z.object({ siteName: text(200), work: text(500), footer: text(500) }).strict();
const boardCreate = z.object({ title: text(200).min(1, "제목을 입력하세요.") }).strict();
const boardSave = z.object({ version: z.number().int().min(1), title: text(200).min(1, "제목을 입력하세요."), body: boardBody, scene: photoScene }).strict();
type BoardRow = { id: string; site_id: string; title: string; body: string; scene: string; version: number; updated_at: string };
type PhotoRow = { id: string; filename: string; format: string; size: number; sha256: string; bytes: Uint8Array; width: number | null; height: number | null; display_size: number | null; display_sha256: string | null; display: Uint8Array | null; created_at: string };
export function isPhotoBoardUpload(method: string, path: string) {
  return method === "POST" && /^\/api\/sites\/[^/]+\/photo-boards\/[^/]+\/photos(\/[^/]+\/display)?\/?$/i.test(path);
}
function getBoard(db: Db, site: string, id: string) {
  const row = db.prepare("SELECT * FROM photo_boards WHERE site_id=? AND id=?").get(site, id) as BoardRow | undefined;
  if (!row) throw new HttpError(404, "사진 보드를 찾을 수 없습니다.");
  return row;
}
export function boardView(db: Db, row: BoardRow) {
  const photos = db.prepare("SELECT id,filename,format,size,width,height,display_size,created_at FROM photo_board_photos WHERE board_id=? ORDER BY created_at,id").all(row.id) as PhotoRow[];
  return {
    id: row.id, title: row.title, version: row.version, updatedAt: row.updated_at, body: JSON.parse(row.body), scene: JSON.parse(row.scene) as z.infer<typeof photoScene>,
    photos: photos.map((p) => ({ id: p.id, filename: p.filename, format: p.format, size: p.size, width: p.width, height: p.height, hasDisplay: p.display_size !== null, createdAt: p.created_at })),
  };
}
export function registerPhotoBoards(app: Express, db: Db, { access, mutate }: SiteOperations, read: ReturnType<typeof boundedUploadReader>) {
  const base = "/api/sites/:siteId/photo-boards";
  const board = (req: Request, write = false) => { access(req, write); return getBoard(db, String(req.params.siteId), String(req.params.id)); };
  const bump = (row: BoardRow) => db.prepare("UPDATE photo_boards SET version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(), row.id);
  app.get(base, (req, res) => {
    access(req);
    const offset = z.coerce.number().int().min(0).max(1000000).default(0).parse(req.query.offset);
    const rows = db.prepare("SELECT id,title,version,updated_at FROM photo_boards WHERE site_id=? ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?").all(String(req.params.siteId), offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base, (req, res) => {
    access(req, true);
    const v = boardCreate.parse(req.body), site = String(req.params.siteId);
    mutate(req, res, `photo-board:create:${site}`, v, () => {
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare("INSERT INTO photo_boards VALUES(?,?,?,?,?,1,?,?,?)")
        .run(id, site, v.title, JSON.stringify({ siteName: "", work: "", footer: "" }), JSON.stringify({ layoutVersion: 1, items: [] }), req.session.userId!, now, now);
      audit(db, req.session.userId!, site, "photo_board.created", id);
      return boardView(db, getBoard(db, site, id));
    }, () => { access(req, true); });
  });
  app.get(base + "/:id", (req, res) => { res.json(boardView(db, board(req))); });
  app.put(base + "/:id", (req, res) => {
    board(req, true);
    const v = boardSave.parse(req.body);
    mutate(req, res, `photo-board:save:${req.params.siteId}:${req.params.id}`, v, () => {
      const row = board(req, true);
      if (row.version !== v.version) throw new HttpError(409, "다른 곳에서 사진 보드가 바뀌었습니다. 입력을 보관하고 최신 내용을 확인하세요.");
      const owned = new Set((db.prepare("SELECT id FROM photo_board_photos WHERE board_id=?").all(row.id) as { id: string }[]).map((p) => p.id)), ids = v.scene.items.map((i) => i.photoId);
      if (new Set(ids).size !== ids.length || ids.some((i) => !owned.has(i))) throw new HttpError(400, "이 보드의 사진만 한 번씩 배치할 수 있습니다.");
      db.prepare("UPDATE photo_boards SET title=?,body=?,scene=?,version=version+1,updated_at=? WHERE id=?").run(v.title, JSON.stringify(v.body), JSON.stringify(v.scene), new Date().toISOString(), row.id);
      audit(db, req.session.userId!, row.site_id, "photo_board.saved", row.id);
      return boardView(db, getBoard(db, row.site_id, row.id));
    }, () => { board(req, true); });
  });
  app.post(base + "/:id/photos", async (req, res, next) => {
    try {
      const row = board(req, true), { version, format, filename } = rawAttachmentMetadata(req, "x-photo-board-version");
      const bytes = await read(req);
      checkRawImageHeader(bytes, format);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      recheckUploadSession(db, req);
      mutate(req, res, `photo-board:photo:${row.site_id}:${row.id}`, { version, filename, format, size: bytes.length, sha256 }, () => {
        const current = board(req, true);
        if (current.version !== version) throw new HttpError(409, "다른 곳에서 사진 보드가 바뀌었습니다. 최신 내용을 확인하세요.");
        if ((db.prepare("SELECT count(*) n FROM photo_board_photos WHERE board_id=?").get(current.id) as { n: number }).n >= PHOTO_BOARD_MAX_PHOTOS)
          throw new HttpError(409, `사진 보드 1건에는 사진을 ${PHOTO_BOARD_MAX_PHOTOS}장까지 둘 수 있습니다.`);
        enforceAttachmentQuota({ ...attachmentUsage(db, current.site_id, current.id, "photo_board"), reportCount: 0 }, bytes.length);
        const id = randomUUID();
        db.prepare("INSERT INTO photo_board_photos(id,board_id,site_id,filename,format,size,sha256,bytes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(id, current.id, current.site_id, filename, format, bytes.length, sha256, bytes, req.session.userId!, new Date().toISOString());
        bump(current);
        audit(db, req.session.userId!, current.site_id, "photo_board.photo_uploaded", id);
        return { photoId: id, board: boardView(db, getBoard(db, current.site_id, current.id)) };
      }, () => { board(req, true); });
    } catch (err) { req.pause(); res.set("Connection", "close"); next(err); }
  });
  app.post(base + "/:id/photos/:photoId/display", async (req, res, next) => {
    try {
      const row = board(req, true), photoId = String(req.params.photoId), { format } = rawAttachmentMetadata(req, "x-photo-board-version");
      if (format !== "image/jpeg") throw new HttpError(400, "표시본은 JPEG만 받습니다.");
      const bytes = await read(req);
      if (bytes.length > PHOTO_DISPLAY_MAX_BYTES) throw new HttpError(400, "표시본은 1MB 이하여야 합니다.");
      checkRawImageHeader(bytes, format);
      const size = imageSize(bytes);
      if (!size || !size.width || !size.height || size.width > PHOTO_DISPLAY_MAX_SIDE || size.height > PHOTO_DISPLAY_MAX_SIDE)
        throw new HttpError(400, `표시본 크기를 확인할 수 없거나 긴 변이 ${PHOTO_DISPLAY_MAX_SIDE}px를 넘습니다.`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      recheckUploadSession(db, req);
      mutate(req, res, `photo-board:display:${row.site_id}:${row.id}:${photoId}`, { photoId, size: bytes.length, sha256 }, () => {
        const current = board(req, true), photo = db.prepare("SELECT display_size FROM photo_board_photos WHERE id=? AND board_id=?").get(photoId, current.id) as { display_size: number | null } | undefined;
        if (!photo) throw new HttpError(404, "이 보드의 사진을 찾을 수 없습니다.");
        if (photo.display_size !== null) throw new HttpError(409, "이미 표시본이 있습니다.");
        enforceAttachmentQuota({ ...attachmentUsage(db, current.site_id, current.id, "photo_board"), reportCount: 0, siteCount: 0 }, bytes.length);
        db.prepare("UPDATE photo_board_photos SET width=?,height=?,display_size=?,display_sha256=?,display=? WHERE id=?").run(size.width, size.height, bytes.length, sha256, bytes, photoId);
        bump(current);
        return boardView(db, getBoard(db, current.site_id, current.id));
      }, () => { board(req, true); });
    } catch (err) { req.pause(); res.set("Connection", "close"); next(err); }
  });
  const photo = (req: Request) => {
    const row = board(req), p = db.prepare("SELECT * FROM photo_board_photos WHERE id=? AND board_id=?").get(String(req.params.photoId), row.id) as PhotoRow | undefined;
    if (!p) throw new HttpError(404, "이 보드의 사진을 찾을 수 없습니다.");
    return p;
  };
  app.get(base + "/:id/photos/:photoId/display", (req, res) => {
    const p = photo(req);
    if (!p.display) throw new HttpError(404, "표시본이 없습니다.");
    const bytes = Buffer.from(p.display);
    if (bytes.length !== p.display_size || createHash("sha256").update(bytes).digest("hex") !== p.display_sha256) throw new HttpError(409, "표시본 크기/해시가 일치하지 않습니다.");
    res.set({ "Content-Type": "image/jpeg", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }).send(bytes);
  });
  app.get(base + "/:id/photos/:photoId/download", (req, res) => { const p = photo(req); sendAttachment(res, p, p.bytes); });
  // 2단계 사진대지: included photos two per page in scene order, from the saved scene. Each photo is an SVG over the display JPEG so
  // rotation, zoom view and circles print exactly as the editor draws them; an odd last slot is marked empty, not stretched.
  app.get(base + "/:id/print", (req, res) => {
    const row = board(req), v = boardView(db, row), body = v.body as { siteName: string; work: string; footer: string }, photos = new Map(v.photos.map((p) => [p.id, p]));
    const src = (id: string) => `/api/sites/${row.site_id}/photo-boards/${row.id}/photos/${id}/display`;
    const slot = (item: z.infer<typeof photoScene>["items"][number]) => {
      const p = photos.get(item.photoId), caption = `<figcaption>${e(item.caption || "설명 미입력")}</figcaption>`;
      if (!p?.hasDisplay || !p.width || !p.height) return `<figure class="photo-slot"><p>표시본 없음 · ${e(p?.filename ?? "")}</p>${caption}</figure>`;
      return `<figure class="photo-slot">${photoSvg({ href: src(p.id), width: p.width, height: p.height, rotation: item.rotation, circles: item.circles, view: item.view, board: item.board === null ? undefined : item.board ?? v.scene.board, label: `${e(item.caption || p.filename)} 사진`, clipId: `v-${p.id}` })}${caption}</figure>`;
    };
    const items = v.scene.items.filter((i) => i.included), pages: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += 2) pages.push(items.slice(i, i + 2));
    const sub = [body.siteName, body.work].filter(Boolean).join(" · ");
    const html = pages.map((p, i) => `<section class="photo-page"><h1>${e(row.title)}</h1><p>${sub ? e(sub) + " · " : ""}${i + 1}/${pages.length}쪽</p>${p.map(slot).join("")}${
      p.length === 1 ? '<figure class="photo-slot"><p>빈 칸</p></figure>' : ""}${body.footer ? `<footer>${e(body.footer)}</footer>` : ""}</section>`).join("");
    res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(row.title)} · 사진대지</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄 / PDF 저장 · 저장된 사진 보드 v${row.version} 기준 · 포함 ${items.length}장</aside><main>${html || "<p>포함된 사진이 없습니다.</p>"}</main></body></html>`);
  });
}
