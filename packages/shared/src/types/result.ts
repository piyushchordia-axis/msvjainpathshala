/**
 * `Result<T, E>` — discriminated union for failable operations.
 *
 * Use this in service-layer code where you want exhaustive handling without
 * exceptions for expected failures (e.g. OTP verification result). Reserve
 * `throw AppError(...)` for paths that bubble straight out to the HTTP layer.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };

export type Result<T, E = Error> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok === true;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return r.ok === false;
}
