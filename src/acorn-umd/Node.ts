import {Node} from 'acorn';

export default class NodeHelper extends Node {
  // @ts-ignore
  constructor(settings) {
    // @ts-ignore
    Object.assign(this, settings);
  }
}