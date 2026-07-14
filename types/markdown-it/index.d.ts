declare class MarkdownIt {
  constructor(preset?: string, options?: object);

  parse(src: string, env: object): import('../../src/types').MdNode[];
}

export = MarkdownIt;
