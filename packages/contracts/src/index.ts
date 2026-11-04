export * from './enums';
export * from './common';
export * from './dto';
export * from './views';
export * from './mutations';
export * from './published';

export const API_VERSION = '2.0.0';
export const APP_VERSION = '2.0.0';
/** Kept in step with `REQUIRED_SCHEMA_VERSION` in `@eh/db`; a build refuses an older database. */
export const DB_SCHEMA_VERSION = 11;
