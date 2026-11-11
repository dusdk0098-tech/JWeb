import type { Express, Request } from "express";
import { createHash } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { costPeriodView, getCostPeriod } from "./cost-model.js";
import { photoGroups } from "./cost-photo-schema.js";
import { z } from "zod";
import { rawAttachmentMetadata, checkRawImageHeader, recheckUploadSession } from "./raw-attachment.js";
import { attachmentUsage, enforceAttachmentQuota } from "./attachment-quota.js";
import type { boundedUploadReader } from "./bounded-upload.js";
import { imageSize, PHOTO_DISPLAY_MAX_BYTES, PHOTO_DISPLAY_MAX_SIDE } from "./image-size.js";
import { escapeHtml as e } from "./print.js";
import { photoSvg } from "./photo-view.js";
export function isCostPhotoUpload(method: string, path: string) {
  return method === "POST" && /^\/api\/sites\/[^/]+\/cost-periods\/[^/]+\/evidence\/files\/[^/]+\/display\/?$/i.test(path);
}
type Display = { attachment_id: string; size: number; sha256: string; bytes: Uint8Array };
// 사진대지 정책안 A: only the browser-made, EXIF-free JPEG is ever shown; the original stays a download.
export function registerCostPhotos(app: Express, db: Db, { access, mutate }: SiteOperations, read: ReturnType<typeof boundedUploadReader>) {
  const base = "/api/sites/:siteId/cost-periods/:id";
  function period(req: Request, write = false) {
    access(req, true, true);
    const row = getCostPeriod(db, String(req.params.siteId), String(req.params.id));
    if (write && row.status !== "open") throw new HttpError(409, "마감 월에는 표시본을 만들 수 없습니다.");
    return row;
  }
  app.post(base + "/evidence/files/:attachmentId/display", async (req, res, next) => {
    try {
      const row = period(req, true), fileId = String(req.params.attachmentId);
      const { format, version } = rawAttachmentMetadata(req, "x-cost-period-version");
      if (format !== "image/jpeg") throw new HttpError(400, "표시본은 JPEG만 받습니다.");
      const bytes = await read(req);
      if (bytes.length > PHOTO_DISPLAY_MAX_BYTES) throw new HttpError(400, "표시본은 1MB 이하여야 합니다.");
      checkRawImageHeader(bytes, format);
      const size = imageSize(bytes);
      if (!size || !size.width || !size.height || size.width > PHOTO_DISPLAY_MAX_SIDE || size.height > PHOTO_DISPLAY_MAX_SIDE)
        throw new HttpError(400, `표시본 크기를 확인할 수 없거나 긴 변이 ${PHOTO_DISPLAY_MAX_SIDE}px를 넘습니다.`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      recheckUploadSession(db, req);
      mutate(req, res, `cost:photo:display:${row.site_id}:${row.id}:${fileId}`, { fileId, size: bytes.length, sha256 }, () => {
        const current = period(req, true);
        if (current.version !== version) throw new HttpError(409, "원장이 다른 곳에서 바뀌었습니다. 최신 조회 후 표시본을 다시 만드세요.");
        const file = db.prepare("SELECT format FROM cost_evidence_files WHERE id=? AND period_id=? AND site_id=?").get(fileId, current.id, current.site_id) as { format: string } | undefined;
        if (!file) throw new HttpError(404, "이 월의 보존 원본을 찾을 수 없습니다.");
        if (file.format === "application/pdf") throw new HttpError(400, "PDF 원본은 사진대지 표시본을 만들 수 없습니다.");
        if (db.prepare("SELECT 1 FROM cost_evidence_displays WHERE attachment_id=?").get(fileId)) throw new HttpError(409, "이미 표시본이 있습니다.");
        // Bytes count toward site/total storage; a display never takes one of the file-count slots.
        enforceAttachmentQuota({ ...attachmentUsage(db, current.site_id, current.id, "cost"), reportCount: 0, siteCount: 0 }, bytes.length);
        // Original SC defaults: 안전시설비 등, empty 내용/촬영일 (출력 전 확인 warns until filled).
        db.prepare("INSERT INTO cost_evidence_displays(attachment_id,site_id,period_id,width,height,size,sha256,bytes,created_by,created_at,group_name,taken_date,description,included,label_version) VALUES(?,?,?,?,?,?,?,?,?,?,'안전시설비 등','','',1,1)")
          .run(fileId, current.site_id, current.id, size.width, size.height, bytes.length, sha256, bytes, req.session.userId!, new Date().toISOString());
        audit(db, req.session.userId!, current.site_id, "cost.photo.display", fileId);
        return { attachmentId: fileId, width: size.width, height: size.height, size: bytes.length, sha256 };
      }, () => { period(req, true); });
    } catch (err) { req.pause(); res.set("Connection", "close"); next(err); }
  });
  app.get(base + "/evidence/files/:attachmentId/display", (req, res) => {
    const row = period(req), d = db.prepare("SELECT * FROM cost_evidence_displays WHERE attachment_id=? AND period_id=? AND site_id=?")
      .get(String(req.params.attachmentId), row.id, row.site_id) as Display | undefined;
    if (!d) throw new HttpError(404, "표시본이 없습니다.");
    const bytes = Buffer.from(d.bytes);
    if (bytes.length !== d.size || createHash("sha256").update(bytes).digest("hex") !== d.sha256) throw new HttpError(409, "표시본 크기/해시가 일치하지 않습니다.");
    res.set({ "Content-Type": "image/jpeg", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" }).send(bytes);
  });
  app.put(base + "/evidence/files/:attachmentId/display/label", (req, res) => {
    period(req, true);
    const v = photoLabel.parse(req.body), fileId = String(req.params.attachmentId);
    mutate(req, res, `cost:photo:label:${req.params.siteId}:${req.params.id}:${fileId}`, v, () => {
      const row = period(req, true),
        d = db.prepare("SELECT label_version FROM cost_evidence_displays WHERE attachment_id=? AND period_id=? AND site_id=?").get(fileId, row.id, row.site_id) as { label_version: number } | undefined;
      if (!d) throw new HttpError(404, "표시본이 없습니다.");
      if (d.label_version !== v.labelVersion) throw new HttpError(409, "다른 곳에서 사진대지 내용이 바뀌었습니다. 입력을 보관하고 최신 목록을 확인하세요.");
      // A group change drops the manual position: the photo joins its new group in date order.
      db.prepare("UPDATE cost_evidence_displays SET group_name=?,taken_date=?,description=?,included=?,rotation=?,circles=?,position=CASE WHEN group_name=? THEN position ELSE NULL END,label_version=label_version+1 WHERE attachment_id=?")
        .run(v.groupName, v.takenDate, v.description, v.included ? 1 : 0, v.rotation, JSON.stringify(v.circles), v.groupName, fileId);
      audit(db, req.session.userId!, row.site_id, "cost.photo.label", fileId);
      return photoBoard(db, row.site_id, row.id);
    }, () => { period(req, true); });
  });
  // Manual order inside one group: the full list of that group's photos with their label versions (any concurrent edit → 409).
  app.put(base + "/photo-board/order", (req, res) => {
    period(req, true);
    const v = photoOrder.parse(req.body);
    mutate(req, res, `cost:photo:order:${req.params.siteId}:${req.params.id}:${v.groupName}`, v, () => {
      const row = period(req, true), current = photoBoard(db, row.site_id, row.id).photos.filter((p) => p.groupName === v.groupName);
      const sent = new Map(v.items.map((i) => [i.attachmentId, i.labelVersion]));
      if (sent.size !== v.items.length || current.length !== sent.size || current.some((p) => sent.get(p.attachmentId) !== p.labelVersion))
        throw new HttpError(409, "분류의 사진 목록이나 내용이 바뀌었습니다. 최신 목록을 확인하세요.");
      const set = db.prepare("UPDATE cost_evidence_displays SET position=?,label_version=label_version+1 WHERE attachment_id=?");
      v.items.forEach((i, n) => set.run(n, i.attachmentId));
      audit(db, req.session.userId!, row.site_id, "cost.photo.order", row.id);
      return photoBoard(db, row.site_id, row.id);
    }, () => { period(req, true); });
  });
  app.get(base + "/photo-board", (req, res) => {
    const row = period(req);
    res.json(photoBoard(db, row.site_id, row.id));
  });
  app.get(base + "/photo-board/print", (req, res) => {
    const row = period(req), board = photoBoard(db, row.site_id, row.id), view = costPeriodView(db, row),
      src = (id: string) => `/api/sites/${encodeURIComponent(row.site_id)}/cost-periods/${encodeURIComponent(row.id)}/evidence/files/${encodeURIComponent(id)}/display`,
      head = `${e(view.month)} 사진대지${view.settings?.projectName ? " · " + e(view.settings.projectName) : ""}`;
    // Like the original output: one section per group, 2 photos per page.
    const sections = photoGroups.flatMap((group) => {
      const slots = board.photos.filter((p) => p.included && p.groupName === group), pages: (typeof slots)[] = [];
      for (let i = 0; i < slots.length; i += 2) pages.push(slots.slice(i, i + 2));
      return pages.map((p, n) => `<section class="photo-page"><h2>${e(group)} (${n + 1}/${pages.length})</h2>${p.map((s) => `<figure class="photo-slot">${photoSvg({ href: src(s.attachmentId), width: s.width, height: s.height, rotation: s.rotation, circles: s.circles, label: `${e(s.description || s.filename)} 사진`, clipId: `c-${s.attachmentId}` })}<figcaption>${e(s.description || "내용 미입력")} · 촬영일 ${e(s.takenDate || "미입력")}</figcaption></figure>`).join("")}</section>`);
    });
    res.type("html").send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${head}</title><link rel="stylesheet" href="/print.css"></head><body><main>
<h1>${head}</h1><p>${view.status === "open" ? "작성 중 원장의 현재 내용" : "마감 원장 기준"}. 사진은 브라우저가 만든 표시본(위치·기기 정보 제거)이며 원본은 증빙 화면에서 내려받습니다.${board.missingDisplay ? ` 표시본 없는 사진 ${board.missingDisplay}장 제외.` : ""}</p>
${sections.join("") || "<p>사진대지에 넣을 사진이 없습니다.</p>"}
</main></body></html>`);
  });
}
const photoLabel = z.object({
  labelVersion: z.number().int().min(1),
  groupName: z.enum(photoGroups, { message: "사진 분류를 선택하세요." }),
  takenDate: z.union([z.literal(""), z.iso.date({ message: "촬영일을 날짜로 입력하세요." })]),
  description: z.string().trim().max(200, { message: "내용은 200자 이하로 입력하세요." }),
  included: z.boolean(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  circles: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), r: z.number().min(0.01).max(0.5), color: z.enum(["red", "yellow", "blue"]) }).strict()).max(10),
}).strict();
const photoOrder = z.object({ groupName: z.enum(photoGroups), items: z.array(z.object({ attachmentId: z.uuid(), labelVersion: z.number().int().min(1) }).strict()).min(1).max(20) }).strict();
type PhotoRow = { attachment_id: string; filename: string; group_name: string; taken_date: string; description: string; included: number; label_version: number; width: number; height: number; rotation: 0 | 90 | 180 | 270; circles: string; position: number | null };
export function photoBoard(db: Db, site: string, id: string) {
  getCostPeriod(db, site, id);
  const order = (g: string) => photoGroups.indexOf(g as (typeof photoGroups)[number]);
  const photos = (db.prepare(`SELECT d.attachment_id,f.filename,d.group_name,d.taken_date,d.description,d.included,d.label_version,d.width,d.height,d.rotation,d.circles,d.position
    FROM cost_evidence_displays d JOIN cost_evidence_files f ON f.id=d.attachment_id WHERE d.period_id=? AND d.site_id=?`).all(id, site) as PhotoRow[])
    .map((r) => ({ attachmentId: r.attachment_id, filename: r.filename, groupName: r.group_name, takenDate: r.taken_date, description: r.description, included: r.included === 1, labelVersion: r.label_version,
      width: r.width, height: r.height, rotation: r.rotation, circles: JSON.parse(r.circles) as z.infer<typeof photoLabel>["circles"], position: r.position }))
    // Within a group: manual positions first (in that order), then the original SC order (촬영일).
    .sort((a, b) => order(a.groupName) - order(b.groupName) || (a.position ?? 1e9) - (b.position ?? 1e9) || a.takenDate.localeCompare(b.takenDate) || a.attachmentId.localeCompare(b.attachmentId));
  const images = (db.prepare("SELECT count(*) n FROM cost_evidence_files WHERE period_id=? AND format!='application/pdf'").get(id) as { n: number }).n;
  return { photos, missingDisplay: images - photos.length };
}
