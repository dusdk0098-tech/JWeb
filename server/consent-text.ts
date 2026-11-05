// MOB-01 2단계 consent text. No imports: shared with the client bundle.
// v1 wording confirmed by the owner on 2026-10-31. Changing the text needs a new version string.
export const TBM_SIGNATURE_CONSENT = {
  version: "tbm-signature-v1",
  retainYears: 3,
  text: [
    "TBM 참여 확인 서명 동의 (v1)",
    "1. 목적: 이 TBM(작업 전 안전회의)에 참여했음을 본인이 직접 확인한 서명을 남깁니다.",
    "2. 기록 항목: 명부상 이름, 서명 이미지, 기록 시각, 서명한 TBM 문서 버전.",
    "3. 보존 기간: 기록일로부터 3년 보관한 뒤 파기합니다.",
    "4. 거부: 동의하지 않으면 서명 없이 참여 의사만 기록되고, 담당자가 수기로 참석을 확인합니다.",
    "5. 이 서명은 참여 확인용이며 법적 효력이나 교육 이수를 판정하지 않습니다.",
  ].join("\n"),
};
export const SIGNATURE_MAX_BYTES = 150 * 1024;
// 근로자 QR 가입 동의 (server/site-signup.ts). DRAFT wording written by the developer on 2026-11-05 — the owner or a legal
// reviewer should confirm it before real use. Changing the text needs a new version string.
export const SIGNUP_CONSENT = {
  version: "site-signup-draft-1",
  items: [
    {
      id: "collect", required: true, title: "[필수] 개인정보 수집·이용 동의",
      text: "수집 항목: 이름, 생년월일 6자리, 소속(업체명). 목적: 현장 출입 계정 만들기와 안전 기록 작성자 확인. 생년월일은 확인용으로 바꾼 값(해시)만 저장하고 원래 숫자는 저장하지 않습니다. 주민등록번호는 받지 않습니다. 보유 기간: 계정을 지우거나 운영자가 현장을 정리할 때까지.",
    },
    {
      id: "share", required: true, title: "[필수] 현장 구성원 표시 동의",
      text: "이름과 소속이 같은 현장의 관리자와 구성원 화면에 표시됩니다. 내가 남긴 기록에는 작성자로 이름이 남습니다. 현장 밖으로 공개하지 않습니다.",
    },
    {
      id: "pledge", required: true, title: "[필수] 서약",
      text: "본인의 이름과 생년월일로 가입하며, 다른 사람 이름으로 가입하거나 기록하지 않겠습니다. 이름과 생년월일을 아는 사람은 내 계정으로 로그인할 수 있으므로 다른 사람에게 알려 주지 않겠습니다.",
    },
  ],
} as const;
