import type {FrozenJSONValue, ReadonlyJSONValue} from './json.js';
import {stringCompare} from './string-compare.js';

/**
 * A cookie is a value that is used to determine the order of snapshots. It
 * needs to be comparable. This can be a string, number or if if you want to use
 * a more complex value, you can use an object with a `order` property. The
 * value `null` is considered to be less than any other cookie and it is used
 * for the first pull when no cookie has been set.
 */
export type Cookie =
  | null
  | string
  | number
  | (ReadonlyJSONValue & {readonly order: number | string});

export type FrozenCookie =
  | null
  | string
  | number
  | (FrozenJSONValue & {readonly order: number | string});

/**
 * Compare two cookies.
 * `null` is considered to be less than any other cookie.
 */
export function compareCookies(a: Cookie, b: Cookie): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  if (b === null) {
    return 1;
  }

  const cva = getCompareValue(a);
  const cvb = getCompareValue(b);

  // If either a or b is a string. Compare by string.
  if (typeof cva === 'string' || typeof cvb === 'string') {
    return stringCompare(String(cva), String(cvb));
  }

  return cva - cvb;
}

type NonNull<T> = T extends null ? never : T;

function getCompareValue(cookie: NonNull<Cookie>): string | number {
  if (typeof cookie === 'string' || typeof cookie === 'number') {
    return cookie;
  }
  return cookie.order;
}
