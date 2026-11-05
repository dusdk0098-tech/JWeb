import type { Express, Request, Response } from "express";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { transaction, type Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { credentials } from "./validation.js";
import { grantsOf } from "./accounts.js";
import { isLocalRequest } from "./local-admin.js";
import { birth6, findWorker } from "./site-signup.js";
import { nameKey } from "./tbm-join.js";
import {
  currentSessionEpoch,
  persistedAccountSession,
} from "./account-session.js";
type Account = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  epoch: number;
};
export const passwordChangeInput = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .strict()
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "새 비밀번호 확인이 일치하지 않습니다.",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "현재 비밀번호와 다른 값을 입력하세요.",
    path: ["newPassword"],
  });
const cookie = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: false,
  path: "/",
};
export async function registerAuthentication(
  app: Express,
  db: Db,
  adsEnabled: () => boolean,
) {
  const dummyHash = await argon2.hash(randomBytes(32), {
    type: argon2.argon2id,
  });
  let active = 0;
  async function bounded<T>(work: () => Promise<T>) {
    if (active >= 2)
      throw new HttpError(
        429,
        "인증 처리가 진행 중입니다. 잠시 후 다시 시도하세요.",
      );
    active++;
    try {
      return await work();
    } finally {
      active--;
    }
  }
  function unchanged(account: Account) {
    const now = db
      .prepare(
        "SELECT u.password_hash,a.epoch FROM users u JOIN account_auth a ON a.user_id=u.id WHERE u.id=?",
      )
      .get(account.id) as { password_hash: string; epoch: number } | undefined;
    return (
      now?.password_hash === account.password_hash &&
      now.epoch === account.epoch
    );
  }
  // Worker accounts (QR signup) have no e-mail: show their affiliation instead of the internal login key.
  const sessionUser = (id: string) => {
    const u = db.prepare("SELECT u.id,CASE WHEN w.user_id IS NULL THEN u.email ELSE '근로자 · ' || w.affiliation END email,u.name,w.user_id IS NOT NULL worker FROM users u LEFT JOIN worker_accounts w ON w.user_id=u.id WHERE u.id=?")
      .get(id) as { id: string; email: string; name: string; worker: number } | undefined;
    return u ? { ...u, worker: !!u.worker } : null;
  };
  async function signIn(req: Request, res: Response, user: Account) {
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) => (err ? reject(err) : resolve())),
    );
    if (!unchanged(user))
      throw new HttpError(401, "인증 정보가 변경되었습니다. 다시 로그인하세요.");
    req.session.userId = user.id;
    req.session.authEpoch = user.epoch;
    req.session.csrf = randomBytes(32).toString("hex");
    req.session.issuedAt = Date.now();
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );
    if (!unchanged(user) || !persistedAccountSession(db, req.sessionID, user.id, user.epoch))
      throw new HttpError(401, "인증 정보가 변경되었습니다. 다시 로그인하세요.");
    res.json({ user: sessionUser(user.id), csrf: req.session.csrf });
  }
  app.get("/api/session", (req, res) => {
    if (req.session.userId && !currentSessionEpoch(db, req.session)) {
      delete req.session.userId;
      delete req.session.authEpoch;
      delete req.session.issuedAt;
      delete req.session.csrf;
    }
    req.session.csrf ||= randomBytes(32).toString("hex");
    const user = req.session.userId ? sessionUser(req.session.userId) : null;
    const grants = req.session.userId ? grantsOf(db, req.session.userId) : { operator: false, issuer: false };
    res.json({ user: user || null, csrf: req.session.csrf, adsEnabled: adsEnabled(), ...grants, local: isLocalRequest(req) });
  });
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      // Loopback-only: every user shares one IP, so count failed attempts per account.
      keyGenerator: (req) => String(req.body?.email ?? "").toLowerCase(),
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." },
    }),
    async (req, res) => {
      const input = credentials.parse(req.body);
      await bounded(async () => {
        const user = db
          .prepare(
            "SELECT u.*,a.epoch FROM users u JOIN account_auth a ON a.user_id=u.id WHERE u.email=?",
          )
          .get(input.email) as Account | undefined;
        const valid = await argon2.verify(
          user?.password_hash || dummyHash,
          input.password,
        );
        if (!user || !valid || !unchanged(user))
          throw new HttpError(401, "이메일 또는 비밀번호를 확인해 주세요.");
        await signIn(req, res, user);
      });
    },
  );
  // 근로자 로그인: name + date of birth (6 digits), the owner's choice; failed tries are counted per name.
  app.post(
    "/api/login/worker",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      keyGenerator: (req) => "worker:" + nameKey(String(req.body?.name ?? "")),
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." },
    }),
    async (req, res) => {
      const input = z.object({ name: z.string().trim().min(1).max(100), birth: birth6 }).strict().parse(req.body);
      await bounded(async () => {
        const id = findWorker(db, input.name, input.birth);
        const user = id
          ? (db.prepare("SELECT u.*,a.epoch FROM users u JOIN account_auth a ON a.user_id=u.id WHERE u.id=?").get(id) as Account | undefined)
          : undefined;
        if (!user)
          throw new HttpError(401, "이름과 생년월일을 확인해 주세요. 처음이면 현장 가입 QR로 가입하세요.");
        await signIn(req, res, user);
      });
    },
  );
  app.use("/api", (req, res, next) => {
    if (!req.session.userId || !currentSessionEpoch(db, req.session))
      return res.status(401).json({ error: "로그인이 필요합니다." });
    next();
  });
  app.post("/api/logout", (req, res, next) =>
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie("pedit.sid", cookie);
      res.status(204).end();
    }),
  );
  app.post(
    "/api/account/password",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      keyGenerator: (req) => req.session.userId!,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "비밀번호 변경 시도가 많습니다. 15분 후 다시 시도해 주세요.",
      },
    }),
    async (req, res) => {
      const input = passwordChangeInput.parse(req.body),
        id = req.session.userId!,
        epoch = req.session.authEpoch!,
        sid = req.sessionID;
      await bounded(async () => {
        const user = db
          .prepare(
            "SELECT u.*,a.epoch FROM users u JOIN account_auth a ON a.user_id=u.id WHERE u.id=?",
          )
          .get(id) as Account | undefined;
        if (
          !user ||
          user.epoch !== epoch ||
          !(await argon2.verify(user.password_hash, input.currentPassword))
        )
          throw new HttpError(401, "현재 비밀번호를 확인해 주세요.");
        const hash = await argon2.hash(input.newPassword, {
          type: argon2.argon2id,
        });
        transaction(db, () => {
          if (!unchanged(user) || !persistedAccountSession(db, sid, id, epoch))
            throw new HttpError(
              401,
              "인증 상태가 변경되었습니다. 다시 로그인하세요.",
            );
          if (epoch >= Number.MAX_SAFE_INTEGER)
            throw new HttpError(
              409,
              "계정 인증 버전 한도입니다. 운영자 점검이 필요합니다.",
            );
          db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
            hash,
            id,
          );
          db.prepare(
            "UPDATE account_auth SET epoch=epoch+1 WHERE user_id=?",
          ).run(id);
          db.prepare(
            "DELETE FROM sessions WHERE json_extract(data,'$.userId')=?",
          ).run(id);
          db.prepare(
            "INSERT INTO account_events(user_id,event,epoch,at) VALUES(?,'password_changed',?,?)",
          ).run(id, epoch + 1, new Date().toISOString());
        });
        await new Promise<void>((resolve, reject) =>
          req.session.destroy((err) => (err ? reject(err) : resolve())),
        );
        res.clearCookie("pedit.sid", cookie);
        res.status(204).end();
      });
    },
  );
}
