export type SetupErrorCode =
  | "invalid"
  | "rejected"
  | "ddl_unavailable"
  | "incomplete";

export type SetupError = {
  ok: false;
  error: string;
  code: SetupErrorCode;
};

export type SetupOk<T extends object = object> = { ok: true } & T;

export type SetupResult<T extends object = object> = SetupOk<T> | SetupError;
