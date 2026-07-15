import Node from './Node.ts';
import type { AstNode } from './Node';
import lookup from 'es-lookup-scope';

interface ImportNode {
  reference: AstNode;
  ast: AstNode;
  specifiers: Array<Node | AstNode>;
  source?: Node | AstNode;
  sources?: Array<Node | AstNode>;
  imports?: [AstNode, AstNode][];
}

class ImportNode extends Node {
  constructor(ast: AstNode, reference: AstNode, settings: Partial<ImportNode>) {
    super(settings);
    this.reference = reference;
    this.ast = ast;
  }

  get scope() {
    return lookup(this, this.ast);
  }
}

export default ImportNode;
