import {merge} from 'lodash';
import {Node} from 'acorn';

export default class NodeHelper extends Node {
  // @ts-ignore
  constructor(settings) {
    // @ts-ignore
    merge(this, settings);
  }
}