import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppConfig } from "../../config/environment.js";
import { IdentityError } from "./errors.js";
import type { IdentityService } from "./service.js";
import type { Account, UserStatus } from "./types.js";

export const sessionCookieName = "exercise_session";

interface IdentityRouteOptions {
  readonly service: IdentityService;
  readonly config: AppConfig;
}

interface CredentialsBody {
  readonly username: string;
  readonly password: string;
}

interface RegistrationBody {
  readonly open: boolean;
}

interface ChangePasswordBody {
  readonly currentPassword: string;
  readonly newPassword: string;
}

interface AccountStatusBody {
  readonly status: UserStatus;
}

interface ResetPasswordBody {
  readonly temporaryPassword: string;
}

const accountSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "username", "role", "status", "passwordChangeRequired"],
  properties: {
    id: { type: "string", format: "uuid" },
    username: { type: "string" },
    role: { type: "string", enum: ["admin", "user"] },
    status: { type: "string", enum: ["active", "disabled"] },
    passwordChangeRequired: { type: "boolean" },
  },
} as const;

function publicAccount(account: Account) {
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    status: account.status,
    passwordChangeRequired: account.passwordChangeRequired,
  };
}

function assertSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (origin === undefined) {
    return;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new IdentityError("invalid_origin", "请求来源无效", 403);
  }
  if (originHost !== request.headers.host) {
    throw new IdentityError("invalid_origin", "请求来源无效", 403);
  }
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  config: AppConfig,
): void {
  reply.setCookie(sessionCookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: config.cookieSecure,
    expires: expiresAt,
  });
}

export async function registerIdentityRoutes(
  app: FastifyInstance,
  options: IdentityRouteOptions,
): Promise<void> {
  const { service, config } = options;

  app.addHook("onRequest", async (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      assertSameOrigin(request);
    }
  });

  async function currentAccount(request: FastifyRequest): Promise<Account> {
    return service.authenticate(request.cookies[sessionCookieName]);
  }

  app.get("/api/v1/auth/registration", {
    schema: {
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["open"],
          properties: { open: { type: "boolean" } },
        },
      },
    },
    handler: async () => service.getRegistrationStatus(),
  });

  app.post<{ Body: CredentialsBody }>("/api/v1/auth/register", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password"],
        properties: {
          username: { type: "string", minLength: 3, maxLength: 32 },
          password: { type: "string", minLength: 12, maxLength: 128 },
        },
      },
      response: { 201: accountSchema },
    },
    handler: async (request, reply) => {
      const session = await service.register(request.body.username, request.body.password);
      setSessionCookie(reply, session.token, session.expiresAt, config);
      return reply.status(201).send(publicAccount(session.account));
    },
  });

  app.post<{ Body: CredentialsBody }>("/api/v1/auth/login", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password"],
        properties: {
          username: { type: "string", minLength: 1, maxLength: 32 },
          password: { type: "string", minLength: 1, maxLength: 128 },
        },
      },
      response: { 200: accountSchema },
    },
    handler: async (request, reply) => {
      const session = await service.login(request.body.username, request.body.password);
      setSessionCookie(reply, session.token, session.expiresAt, config);
      return publicAccount(session.account);
    },
  });

  app.post("/api/v1/auth/logout", {
    schema: { response: { 204: { type: "null" } } },
    handler: async (request, reply) => {
      await service.logout(request.cookies[sessionCookieName]);
      reply.clearCookie(sessionCookieName, { path: "/" });
      return reply.status(204).send();
    },
  });

  app.get("/api/v1/auth/me", {
    schema: { response: { 200: accountSchema } },
    handler: async (request) => publicAccount(await currentAccount(request)),
  });

  app.put<{ Body: ChangePasswordBody }>("/api/v1/auth/password", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["currentPassword", "newPassword"],
        properties: {
          currentPassword: { type: "string", minLength: 1, maxLength: 128 },
          newPassword: { type: "string", minLength: 12, maxLength: 128 },
        },
      },
      response: { 200: accountSchema },
    },
    handler: async (request, reply) => {
      const session = await service.changePassword(
        await currentAccount(request),
        request.body.currentPassword,
        request.body.newPassword,
      );
      setSessionCookie(reply, session.token, session.expiresAt, config);
      return publicAccount(session.account);
    },
  });

  app.get("/api/v1/admin/accounts", {
    schema: {
      response: {
        200: { type: "array", items: accountSchema },
      },
    },
    handler: async (request) =>
      (await service.listAccounts(await currentAccount(request))).map(publicAccount),
  });

  app.put<{ Body: RegistrationBody }>("/api/v1/admin/settings/registration", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["open"],
        properties: { open: { type: "boolean" } },
      },
      response: {
        200: {
          type: "object",
          additionalProperties: false,
          required: ["open"],
          properties: { open: { type: "boolean" } },
        },
      },
    },
    handler: async (request) => {
      await service.setRegistrationOpen(await currentAccount(request), request.body.open);
      return { open: request.body.open };
    },
  });

  app.put<{ Params: { userId: string }; Body: AccountStatusBody }>(
    "/api/v1/admin/accounts/:userId/status",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", enum: ["active", "disabled"] } },
        },
        response: { 200: accountSchema },
      },
      handler: async (request) =>
        publicAccount(
          await service.setAccountStatus(
            await currentAccount(request),
            request.params.userId,
            request.body.status,
          ),
        ),
    },
  );

  app.post<{ Params: { userId: string } }>("/api/v1/admin/accounts/:userId/revoke-sessions", {
    schema: {
      params: {
        type: "object",
        additionalProperties: false,
        required: ["userId"],
        properties: { userId: { type: "string", format: "uuid" } },
      },
      response: { 204: { type: "null" } },
    },
    handler: async (request, reply) => {
      await service.revokeAccountSessions(await currentAccount(request), request.params.userId);
      return reply.status(204).send();
    },
  });

  app.put<{ Params: { userId: string }; Body: ResetPasswordBody }>(
    "/api/v1/admin/accounts/:userId/password",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["temporaryPassword"],
          properties: {
            temporaryPassword: { type: "string", minLength: 12, maxLength: 128 },
          },
        },
        response: { 200: accountSchema },
      },
      handler: async (request) =>
        publicAccount(
          await service.resetAccountPassword(
            await currentAccount(request),
            request.params.userId,
            request.body.temporaryPassword,
          ),
        ),
    },
  );
}
