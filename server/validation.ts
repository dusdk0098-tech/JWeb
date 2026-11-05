import { z } from "zod";
const short = z.string().trim().min(1).max(200);
const prose = z.string().trim().max(20000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "올바른 날짜가 필요합니다.");
export const meetingInput = z
  .object({
    title: short,
    type: z.enum(["안전보건협의체", "기타"]),
    date,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    location: short,
    attendees: prose,
    agenda: prose,
    discussion: prose,
    decisions: prose,
    actions: z
      .array(
        z
          .object({
            task: short,
            owner: short,
            due: date,
            status: z.enum(["대기", "진행", "완료"]),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type MeetingInput = z.infer<typeof meetingInput>;
export const credentials = z
  .object({
    // e-mail, or a login ID from 현장 관리자 가입 신청 (server/manager-signup.ts LOGIN_ID)
    email: z
      .string()
      .trim()
      .max(254)
      .refine((v) => z.email().safeParse(v).success || /^[a-z0-9][a-z0-9._-]{3,29}$/i.test(v), "이메일 또는 아이디를 확인하세요.")
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export const siteInput = z.object({ name: short }).strict();
export const memberInput = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    role: z.enum(["manager", "editor", "viewer"]),
  })
  .strict();
export const revision = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
