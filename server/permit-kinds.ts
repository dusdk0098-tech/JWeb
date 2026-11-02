// 작업허가서 종류와 확인 항목. No imports: the screen (src/PermitsPanel.tsx) reads the same list.
export const PERMIT_KINDS = {
  hot: { label: "화기 작업", checks: ["작업 반경의 가연물을 치우거나 불연 덮개로 덮었다", "소화기를 두고 화재감시자를 정했다", "용접·용단 장비와 가스 호스 상태를 확인했다", "작업 뒤 잔불 확인 방법을 정했다"] },
  confined: { label: "밀폐공간 작업", checks: ["산소·유해가스 농도를 측정하고 값을 기록했다", "환기 장치를 가동한다", "감시인을 정했다", "구조 장비와 연락 수단을 갖췄다", "출입 인원 명단을 남긴다"] },
  height: { label: "고소 작업", checks: ["안전대와 부착설비를 갖췄다", "작업발판·안전난간을 확인했다", "개구부 덮개를 확인했다", "강풍·강우 때 중지 기준을 정했다"] },
  heavy: { label: "중장비 작업", checks: ["운전자 자격·장비 서류를 확인했다", "신호수를 정했다", "작업 반경 출입을 통제한다", "지반과 아웃트리거 설치를 확인했다"] },
  electric: { label: "전기 작업", checks: ["전원을 차단하고 시건·표지를 했다", "검전기로 정전을 확인했다", "절연 보호구를 갖췄다"] },
  other: { label: "기타 위험 작업", checks: [] as string[] },
} as const;
export type PermitKind = keyof typeof PERMIT_KINDS;
