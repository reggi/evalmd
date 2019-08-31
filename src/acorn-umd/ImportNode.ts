import Node from './Node';
import lookup from 'es-lookup-scope';

export default class ImportNode extends Node {
  reference: any
  ast: any

  constructor(ast, reference, settings) {
    super(settings);
    this.reference = reference;
    this.ast = ast;
  }

  get scope() {
    return lookup(this, this.ast);
  }
}