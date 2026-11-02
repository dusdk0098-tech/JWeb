import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { account, type TemplateSnapshot } from "./inspection-model.js";
// 기본 점검 양식 (검토 F1): a new site starts with these published forms so the first inspection can be written at once.
// They are ordinary site forms: the manager may revise or stop each one, and they claim no legal status. Wording is the
// kind of plain checklist a site already writes by hand; no engineering limits or legal judgements are encoded.
const NOTE = "앱이 처음에 넣어 준 참고 양식입니다. 현장에 맞게 '정정'으로 고치거나 쓰지 않는 양식은 사용 중지하세요. 법정 양식·안전 인증이 아닙니다.";
export const DEFAULT_TEMPLATES: { title: string; items: string[] }[] = [
  { title: "일일 안전점검 (일반)", items: [
    "작업 전 TBM을 실시하고 참석자를 기록했다", "작업 구역 출입 통제·표지가 설치되어 있다", "통로·계단에 자재·장애물이 없다",
    "보호구(안전모·안전대·안전화)를 착용하고 있다", "소화기·비상 연락망이 지정 위치에 있다", "자재 적재가 안정되어 넘어질 위험이 없다",
    "전선·배선이 통로를 가로지르지 않고 손상이 없다", "조명이 작업에 충분하다", "정리정돈 상태가 양호하다", "전날 지적 사항이 조치되었다",
  ] },
  { title: "추락 위험 작업", items: [
    "개구부·단부에 덮개 또는 안전난간이 설치되어 있다", "추락 방호망 또는 안전대 부착설비가 설치되어 있다", "안전대를 착용하고 부착설비에 걸었다",
    "작업발판 폭·간격이 적정하고 고정되어 있다", "사다리 사용 시 전도 방지 조치를 했다", "악천후(강풍·강우) 시 작업 중지 기준을 확인했다",
    "추락 위험 구역에 출입 통제 표지가 있다", "작업자 2인 이상 또는 감시자를 배치했다",
  ] },
  { title: "전기·감전", items: [
    "임시 분전반에 누전차단기가 설치되고 동작을 확인했다", "전선 피복 손상·접속부 노출이 없다", "접지가 연결되어 있다",
    "전기 작업 전 전원 차단·시건·표지를 했다", "젖은 장소에서 전동공구를 쓰지 않는다", "충전부 근처 작업에 절연 보호구를 착용했다",
    "가공 전선로와 장비·자재의 이격 거리를 확인했다",
  ] },
  { title: "양중·중장비 작업", items: [
    "운전자 자격·보험·검사 서류를 확인했다", "신호수를 배치하고 신호 방법을 정했다", "작업 반경 내 출입을 통제했다",
    "와이어·슬링·훅의 손상 여부를 확인했다", "지반 상태와 아웃트리거 설치를 확인했다", "인양물 하부에 사람이 없다",
    "강풍 시 양중 작업 중지 기준을 확인했다", "후방 카메라·경보 장치가 작동한다",
  ] },
  { title: "밀폐공간 작업", items: [
    "작업 전 산소·유해가스 농도를 측정하고 기록했다", "환기 장치를 가동하고 있다", "감시인을 배치했다",
    "출입 인원 명단과 출입 시각을 기록했다", "구조 장비(안전대·구명줄)와 연락 수단을 갖췄다", "작업 중 농도를 주기적으로 재측정한다",
    "작업허가 절차(있는 경우)를 따랐다",
  ] },
  { title: "화기 작업", items: [
    "작업 반경 내 가연물을 제거하거나 불연 덮개로 덮었다", "소화기를 비치하고 화재감시자를 배치했다", "용접·용단 장비와 가스 호스의 상태를 확인했다",
    "가스통 전도 방지·밸브 상태를 확인했다", "작업 종료 후 잔불 확인을 했다", "주변 작업자에게 화기 작업을 알렸다", "작업허가 절차(있는 경우)를 따랐다",
  ] },
  { title: "보호구 착용 확인", items: [
    "안전모 착용과 턱끈 체결", "안전화 착용", "고소 작업자의 안전대 착용", "분진·유해물질 작업의 호흡 보호구 착용",
    "소음 작업의 귀마개·귀덮개 착용", "보안경·보호장갑 등 작업별 보호구 착용",
  ] },
  { title: "작업발판·비계", items: [
    "비계 조립 후 점검표에 따라 점검했다", "작업발판이 빈틈없이 고정되고 폭이 충분하다", "안전난간(상부·중간·발끝막이판)이 설치되어 있다",
    "벽 이음·버팀대가 설치되어 있다", "승강 통로(계단·사다리)가 설치되어 있다", "적재 하중을 넘지 않는다",
    "비계 변경·해체 작업 중 출입 통제를 했다", "악천후 후 비계 상태를 다시 점검했다",
  ] },
];
export function seedDefaultTemplates(db: Db, siteId: string, userId: string) {
  const site = db.prepare("SELECT name FROM sites WHERE id=?").get(siteId) as { name: string };
  const publishedBy = account(db, userId), now = new Date().toISOString();
  const insert = db.prepare("INSERT INTO inspection_templates VALUES(?,?,NULL,?,'published',2,?,?)");
  for (const t of DEFAULT_TEMPLATES) {
    const id = randomUUID();
    const body = { title: t.title, instructions: NOTE, items: t.items.map((text) => ({ id: randomUUID(), text })) };
    const snapshot: TemplateSnapshot = { id, version: 2, body, siteName: site.name, publishedBy, publishedAt: now };
    insert.run(id, siteId, JSON.stringify(body), JSON.stringify(snapshot), now);
    audit(db, userId, siteId, "inspection.template.seeded", id);
  }
}
