import type * as ESTree from 'estree';

type WithPosition = { start: number; end: number; stop?: number };

export type Positioned<T> =
  T extends readonly (infer U)[]
    ? Positioned<U>[]
    : T extends ESTree.BaseNodeWithoutComments
      ? { [K in keyof T]: Positioned<T[K]> } & WithPosition
      : T;

export type AstNode = Positioned<ESTree.Node>;

interface LocalIdentifier {
  type?: string;
  start?: number;
  end?: number;
  name?: string;
}

interface NodeProperties {
  type: string;
  start: number;
  end: number;
  stop?: number;
  local: LocalIdentifier;
  imported?: AstNode;
  default?: boolean;
  reference?: AstNode;
  value?: unknown;
  raw?: string;
}

interface NodeHelper extends NodeProperties {}

class NodeHelper {
  // Props live on the merged interface, not as class fields, so `useDefineForClassFields` cannot reset the values set here.
  constructor(settings: Partial<NodeProperties>) {
    Object.assign(this, settings);
  }
}

export default NodeHelper;
