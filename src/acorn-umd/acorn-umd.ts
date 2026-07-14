import type * as ESTree from 'estree';
import type { Node as AcornNode } from 'acorn';
import assign from 'object.assign';
import estraverse from 'estraverse';
import Node from './Node';
import type { AstNode, Positioned } from './Node';
import ImportNode from './ImportNode';
import type { UmdOptions } from '../types';

type CallNode = Positioned<ESTree.SimpleCallExpression>;
type ArrayNode = Positioned<Omit<ESTree.ArrayExpression, 'elements'>> & {
  elements: Positioned<ESTree.Expression | ESTree.SpreadElement>[];
};
type FuncNode = Positioned<ESTree.FunctionExpression | ESTree.ArrowFunctionExpression>;

function isRequireCallee(node: AstNode) {
  return node.type === 'CallExpression'
    && !!node.callee
    && node.callee.type === 'Identifier'
    && node.callee.name === 'require';
}

function isDefineCallee(node: AstNode): node is CallNode {
  return node.type === 'CallExpression'
    && !!node.callee
    && node.callee.type === 'Identifier'
    && node.callee.name === 'define';
}

function isArrayExpr(node: AstNode): node is ArrayNode {
  return node.type === 'ArrayExpression';
}

function isFuncExpr(node: AstNode): node is FuncNode {
  return /FunctionExpression$/.test(node.type);
}

// Set up an AST Node similar to an ES6 import node
function constructImportNode(ast: AstNode, node: AstNode, type: string) {
  let {start, end} = node;
  return new ImportNode(ast, node, {
    type,
    specifiers: [],
    start, end
  });
}

function createImportSpecifier(source: AstNode, definition: AstNode, isDef: boolean) {
  let imported: AstNode | undefined;
  if (definition.type === 'MemberExpression') {
    imported = assign({}, definition.property);
    isDef = false;
  }

  // Add the specifier
  let {type, start, end} = source;
  let name = 'name' in source ? source.name : undefined;

  return new Node({
    start, end,
    type: 'ImportSpecifier',
    local: {
      type, start, end, name
    },
    imported,
    default: isDef
  });
}

function createSourceNode(node: AstNode, source: AstNode) {
  let {start, end} = source;
  let value = 'value' in source ? source.value : undefined;
  let raw = 'raw' in source ? source.raw : undefined;
  return new Node({
    type: 'Literal',
    reference: node,
    value, raw, start, end
  });
}

function setImportSource(result: ImportNode, node: AstNode, importExpr: AstNode) {
  if (importExpr.type === 'MemberExpression') {
    importExpr = importExpr.object;
  }

  result.source = createSourceNode(node, (importExpr as CallNode).arguments[0]);
  return result;
}

function constructCJSImportNode(ast: AstNode, node: AstNode) {
  let result = constructImportNode(ast, node, 'CJSImport');
  let importExpr: AstNode = node;

  switch (node.type) {
    case 'MemberExpression':
    case 'CallExpression':
      importExpr = node;
      break;
    case 'AssignmentExpression': {
      let specifier = createImportSpecifier(node.left, node.right, false);
      let named = 'property' in node.left ? node.left.property : node.left;
      let name = 'name' in named ? named.name : undefined;
      specifier.local.name = name;
      result.specifiers.push(specifier);
      importExpr = node.right;
      break;
    }
    case 'VariableDeclarator':
      // init for var, value for property
      importExpr = node.init ?? node;
      result.specifiers.push(createImportSpecifier(node.id, importExpr, true));
      break;
    case 'Property': {
      // init for var, value for property
      importExpr = node.value;
      result.specifiers.push(createImportSpecifier(node.key, importExpr, false));
    }
  }

  return setImportSource(result, node, importExpr);
}

function findCJS(ast: Positioned<ESTree.Program>) {
  // Recursively walk ast searching for requires
  let requires: AstNode[] = [];

  estraverse.traverse(ast as ESTree.Node, {
    fallback: 'iteration',
    enter(esNode) {
      const node = esNode as AstNode;
      function checkRequire(expr: AstNode | null | undefined) {
        if (expr && expr.type === 'MemberExpression') {
          expr = expr.object;
        }
        if (expr && isRequireCallee(expr)) {
          requires.push(node);
          return true;
        }
      }

      switch (node.type) {
        case 'MemberExpression':
        case 'CallExpression':
          checkRequire(node);
          break;
        case 'AssignmentExpression':
          checkRequire(node.right);
          break;
        case 'Property':
          checkRequire(node.value);
          break;
        case 'VariableDeclarator':
          checkRequire(node.init);
      }
    }
  });

  // Filter the overlapping requires (e.g. if var x = require('./x') it'll show up twice).
  // Do this by just checking line #'s
  return requires.filter(node => {
      return !requires.some(parent =>
        [node.start, node.stop].some(pos => pos !== undefined && pos > parent.start && pos < parent.end));
    })
    .map(node => constructCJSImportNode(ast, node));
}

// Note there can be more than one define per file with global registeration.
function findAMD(ast: Positioned<ESTree.Program>) {
  return ast.body
  .filter((node): node is Positioned<ESTree.ExpressionStatement> => node.type === 'ExpressionStatement')
  .map(node => node.expression)
  .filter(isDefineCallee)
  // Ensure the define takes params and has a function
  .filter(node => node.arguments.length <= 3)
  .filter(node => node.arguments.filter(isFuncExpr).length === 1)
  .filter(node => node.arguments.filter(isArrayExpr).length <= 1)
  // Now just zip the array arguments and the provided function params
  .map(node => {
    let outnode = constructImportNode(ast, node, 'AMDImport');

    let func = node.arguments.filter(isFuncExpr)[0];
    let imports = node.arguments.find(isArrayExpr) || {elements: []};

    let params = func.params.slice(0, imports.elements.length);
    outnode.specifiers = params;

    if (imports) {
      // Use an array even though its not spec as there isn't a better way to
      // represent this structure
      outnode.sources = imports.elements.map(imp => createSourceNode(node, imp));
      // Make nicer repr: [[importSrc, paramName]]
      outnode.imports = imports.elements.map((imp, i): [AstNode, AstNode] => [imp, params[i]]);
    }
    return outnode;
  });
}

export default function(ast: AcornNode, options: UmdOptions) {
  options = assign({
    cjs: true,
    // TODO
    amd: false,
    es6: true
  }, options);

  let result: ImportNode[] = [];
  let root = ast as Positioned<ESTree.Program>;

  if (options.cjs) {
    result.push(...findCJS(root));
  }

  if (options.es6) {
    result.push(...root.body
    .filter((node): node is Positioned<ESTree.ImportDeclaration> => node.type === 'ImportDeclaration')
    .map(node => new ImportNode(root, node, node)));
  }

  if (options.amd) {
    result.push(...findAMD(root));
  }

  return result.sort((a, b) => a.start - b.start);
}
