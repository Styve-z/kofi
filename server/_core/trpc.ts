import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { can, type Permission } from "@shared/permissions";
import { twoFactorRequired } from "../modules/twoFactor";

/** Administrateurs et super-administrateur : rien n’est accessible tant que la double vérification n’est pas activée. */
function assertSecondFactorReady(user: { role: string; twoFactorEnabledAt: Date | null }) {
  if (twoFactorRequired(user.role) && !user.twoFactorEnabledAt) throw new TRPCError({ code: "FORBIDDEN", message: "TWO_FACTOR_SETUP_REQUIRED" });
}
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (ctx.user.status === "suspended") {
    throw new TRPCError({ code: "FORBIDDEN", message: "ACCOUNT_SUSPENDED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin' || ctx.user.status === "suspended") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/** Procédure réservée à l’équipe KOFI disposant de la permission demandée (voir shared/permissions.ts). */
export const staffProcedure = (permission: Permission) => t.procedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || ctx.user.status === "suspended" || !can(ctx.user.role, permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    assertSecondFactorReady(ctx.user);
    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);

/** Procédure réservée au super-administrateur (rôle « superadmin », compte actif). */
export const superAdminProcedure = t.procedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.user || ctx.user.status === "suspended" || ctx.user.role !== "superadmin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    assertSecondFactorReady(ctx.user);
    return next({ ctx: { ...ctx, user: ctx.user } });
  }),
);