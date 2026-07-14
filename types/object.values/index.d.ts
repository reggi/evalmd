declare function values<T extends object>(obj: T): T[keyof T][];

export = values;
