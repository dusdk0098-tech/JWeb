import { z } from "zod";
import { date, revision } from "./validation.js";
import { journalMonth } from "./daily-monthly-report.js";
import { laborKinds } from "./cost-labor-kinds.js";
export { laborKinds };
const numeric = z.string().min(1).max(32),
  reason = z.string().trim().min(1).max(1000);
export const costCreate = z
  .object({
    month: journalMonth,
    openingNote: reason,
    categories: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(100),
            plan: numeric,
            opening: numeric,
            scCode: z.number().int().min(1).max(9).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const costVersion = z.object({ version: revision }).strict();
export const costReason = costVersion.extend({ reason });
export const costBudget = costReason.extend({
  plans: z
    .array(z.object({ categoryId: z.uuid(), plan: numeric }).strict())
    .min(1)
    .max(20),
  openings: z
    .array(z.object({ categoryId: z.uuid(), opening: numeric }).strict())
    .min(1)
    .max(20)
    .optional(),
});
export const expenseInput = z
  .object({
    categoryId: z.uuid(),
    spendDate: date,
    description: z.string().trim().min(1).max(500),
    quantity: numeric,
    unitPriceWon: numeric,
  })
  .strict();
// 인건비 구분: omitted = unchanged, null = clear.
const laborKind = z.enum(laborKinds).nullable().optional();
const details = z.record(z.string().max(40), z.string().max(200)).optional();
export const expenseCreate = costVersion.extend({ expense: expenseInput, laborKind, details });
export const expenseEdit = costReason.extend({ expense: expenseInput, laborKind, details });
// SC 현장 설정 (original PEDIT-SC settings form). Empty string = not entered yet.
const settingText = z.string().trim().max(200),
  settingDate = z.union([z.literal(""), date]),
  settingWon = z.union([z.literal(""), z.string().regex(/^(0|[1-9]\d{0,14})$/, "원 단위 정수로 입력하세요.")]),
  settingPercent = z.union([z.literal(""), z.string().regex(/^(100(\.0{1,2})?|(0|[1-9]\d?)(\.\d{1,2})?)$/, "0~100 사이, 앞자리 0 없이 소수 2자리까지 입력하세요.")]);
export const costSettings = z
  .object({
    writtenDate: settingDate,
    projectName: settingText,
    contractor: settingText,
    location: settingText,
    representative: settingText,
    client: settingText,
    projectStart: settingDate,
    projectEnd: settingDate,
    summarySameAsProject: z.boolean(),
    summaryStart: settingDate,
    summaryEnd: settingDate,
    contractAmountWon: settingWon,
    coverProgress: settingPercent,
    cumulativeProgress: settingPercent,
    safetyBudgetWon: settingWon,
    author: settingText,
    reviewer: settingText,
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const [a, b, label] of [
      ["projectStart", "projectEnd", "공사기간"],
      ["summaryStart", "summaryEnd", "내역집계표 공사기간"],
    ] as const) {
      if (!s[a] !== !s[b])
        ctx.addIssue({ code: "custom", path: [a], message: `${label}은 시작일과 종료일을 모두 입력하세요.` });
      else if (s[a] > s[b])
        ctx.addIssue({ code: "custom", path: [a], message: `${label} 시작일은 종료일보다 늦을 수 없습니다.` });
    }
  });
export type CostSettings = z.infer<typeof costSettings>;
export const costSettingsSave = costVersion.extend({ settings: costSettings });
