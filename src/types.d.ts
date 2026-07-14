export interface EsNode {
  type: string;
  start: number;
  end: number;
  stop?: number;
  body?: EsNode[];
  name?: string;
  raw?: string;
  value?: unknown;
  callee?: EsNode;
  object?: EsNode;
  property?: EsNode;
  arguments?: EsNode[];
  elements?: EsNode[];
  params?: EsNode[];
  expression?: EsNode;
  id?: EsNode;
  init?: EsNode;
  key?: EsNode;
  left?: EsNode;
  right?: EsNode;
  source?: EsNode;
  local?: EsNode;
  imported?: EsNode;
  reference?: EsNode;
  specifiers?: EsNode[];
  sources?: EsNode[];
  imports?: [EsNode, EsNode | undefined][];
  default?: boolean;
}

export interface UmdOptions {
  cjs?: boolean;
  amd?: boolean;
  es6?: boolean;
}

export interface EvalBuild {
  preserve: string;
  concat: string;
  preserveAlter: string;
  concatAlter: string;
}

export interface Package {
  name: string;
  path: string;
}

export interface Dep {
  source: {
    value: string;
    start: number;
    end: number;
  };
}

export interface ParseOptions {
  parse?: ((code: string) => any) | false;
  sloppy?: boolean;
}

export type Logger = ReturnType<typeof import('./log')>;

export interface MdNode {
  type?: string;
  tag?: string;
  info?: string;
  content?: string;
  map?: [number, number] | null;
  children: MdNode[];
  id?: number;
  fileEval?: string | boolean;
  preventEval?: boolean;
  startLine?: number | false;
  endLine?: number | false;
  previousFenceIndex?: number;
  prevFenceIndex?: number;
  fileEvalHash?: string;
  fileEvalHashPath: string;
  evalCode?: EvalBuild | Error | false;
  fileCreated?: boolean;
  fileName?: MdNode;
  evalResult?: unknown;
  parse?: ((code: string) => any) | false;
  fileRemove?: unknown;
  notice?: unknown;
  evaluated?: MdNode[];
}

export type ConcatNode = readonly MdNode[] & Partial<Omit<MdNode, 'map'>>;

export interface AssembleData {
  markdown?: string;
  markdownLines?: string[];
  nodes?: MdNode[];
  allFences?: MdNode[];
  allJsFences?: MdNode[];
  permittedFences?: MdNode[];
  evalNodes?: MdNode[];
  kinds?: string[];
  kindFences?: { [kind: string]: MdNode[] };
  blockScope?: boolean;
  evaluated?: { evalResult?: unknown }[] | false;
  outputed?: unknown;
}

export interface StackBuckets {
  frame: string[];
  lines: string[];
}

export interface MatchLineChar {
  lineChar: string | number;
  line: number;
  char: number | false;
}

declare global {
  interface ArrayConstructor {
    isArray<T>(arg: T): arg is [Extract<T, readonly unknown[]>] extends [never] ? T & any[] : Extract<T, readonly unknown[]>;
  }
}
