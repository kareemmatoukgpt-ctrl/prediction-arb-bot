declare module 'better-sqlite3' {
  class Database {
    constructor(filename: string);
    prepare(sql: string): any;
    exec(sql: string): void;
    pragma(pragma: string): any;
    close(): void;
  }
  export = Database;
}

declare module 'express' {
  const e: any;
  export = e;
}

declare module 'cors' {
  const c: any;
  export = c;
}

declare module 'uuid' {
  export function v4(): string;
}

declare module 'dotenv' {
  export function config(options?: any): void;
}
