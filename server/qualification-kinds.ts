// 교육·자격 종류. No imports: the screen (src/QualificationsPanel.tsx) reads the same list.
// The hints describe what people usually record; the app does not compute legal cycles or expiry dates.
export const QUALIFICATION_KINDS = {
  basic: { label: "건설업 기초안전보건교육", hint: "이수증 번호를 적으세요. 보통 만료일이 없습니다." },
  operator: { label: "건설기계 조종사 안전교육", hint: "주기가 있는 교육입니다. 다음 이수 기한을 만료일에 직접 입력하세요." },
  special: { label: "특별교육", hint: "해당 작업을 시작하기 전에 받는 교육입니다." },
  hire: { label: "채용 시 교육", hint: "" },
  periodic: { label: "정기교육", hint: "" },
  license: { label: "면허 · 자격증", hint: "만료일이 있는 면허는 만료일을 입력하세요." },
  other: { label: "기타", hint: "" },
} as const;
export type QualificationKind = keyof typeof QUALIFICATION_KINDS;
export const SOON_DAYS = 30;
