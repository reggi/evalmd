"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var object_assign_1 = __importDefault(require("object.assign"));
var estraverse_1 = __importDefault(require("estraverse"));
var Node_1 = __importDefault(require("./Node"));
var ImportNode_1 = __importDefault(require("./ImportNode"));
function isRequireCallee(node) {
    return node.type === 'CallExpression'
        && !!node.callee
        && node.callee.name === 'require'
        && node.callee.type === 'Identifier';
}
function isDefineCallee(node) {
    return node.type === 'CallExpression'
        && !!node.callee
        && node.callee.name === 'define'
        && node.callee.type === 'Identifier';
}
function isArrayExpr(node) {
    return node.type === 'ArrayExpression';
}
function isFuncExpr(node) {
    return /FunctionExpression$/.test(node.type);
}
// Set up an AST Node similar to an ES6 import node
function constructImportNode(ast, node, type) {
    var start = node.start, end = node.end;
    return new ImportNode_1.default(ast, node, {
        type: type,
        specifiers: [],
        start: start, end: end
    });
}
function createImportSpecifier(source, definition, isDef) {
    var imported;
    if (definition.type === 'MemberExpression') {
        imported = object_assign_1.default({}, definition.property);
        isDef = false;
    }
    // Add the specifier
    var name = source.name, type = source.type, start = source.start, end = source.end;
    return new Node_1.default({
        start: start, end: end,
        type: 'ImportSpecifier',
        local: {
            type: type, start: start, end: end, name: name
        },
        imported: imported,
        default: isDef
    });
}
function createSourceNode(node, source) {
    var value = source.value, raw = source.raw, start = source.start, end = source.end;
    return new Node_1.default({
        type: 'Literal',
        reference: node,
        value: value, raw: raw, start: start, end: end
    });
}
function setImportSource(result, node, importExpr) {
    if (importExpr.type === 'MemberExpression') {
        importExpr = importExpr.object;
    }
    result.source = createSourceNode(node, importExpr.arguments[0]);
    return result;
}
function constructCJSImportNode(ast, node) {
    var result = constructImportNode(ast, node, 'CJSImport');
    var importExpr;
    switch (node.type) {
        case 'MemberExpression':
        case 'CallExpression':
            importExpr = node;
            break;
        case 'AssignmentExpression':
            var specifier = createImportSpecifier(node.left, node.right, false);
            var name_1 = (node.left.property || node.left).name;
            specifier.local.name = name_1;
            result.specifiers.push(specifier);
            importExpr = node.right;
            break;
        case 'VariableDeclarator':
            // init for var, value for property
            importExpr = node.init;
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
function findCJS(ast) {
    // Recursively walk ast searching for requires
    var requires = [];
    estraverse_1.default.traverse(ast, {
        enter: function (node) {
            function checkRequire(expr) {
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
    return requires.filter(function (node) {
        return !requires.some(function (parent) {
            return [node.start, node.stop].some(function (pos) { return pos > parent.start && pos < parent.end; });
        });
    })
        .map(function (node) { return constructCJSImportNode(ast, node); });
}
// Note there can be more than one define per file with global registeration.
function findAMD(ast) {
    return ast.body
        .filter(function (node) { return node.type === 'ExpressionStatement'; })
        .map(function (node) { return node.expression; })
        .filter(isDefineCallee)
        // Ensure the define takes params and has a function
        .filter(function (node) { return node.arguments.length <= 3; })
        .filter(function (node) { return node.arguments.filter(isFuncExpr).length === 1; })
        .filter(function (node) { return node.arguments.filter(isArrayExpr).length <= 1; })
        // Now just zip the array arguments and the provided function params
        .map(function (node) {
        var outnode = constructImportNode(ast, node, 'AMDImport');
        var func = node.arguments.find(isFuncExpr);
        var imports = node.arguments.find(isArrayExpr) || { elements: [] };
        var params = func.params.slice(0, imports.elements.length);
        outnode.specifiers = params;
        if (imports) {
            // Use an array even though its not spec as there isn't a better way to
            // represent this structure
            outnode.sources = imports.elements.map(function (imp) { return createSourceNode(node, imp); });
            // Make nicer repr: [[importSrc, paramName]]
            outnode.imports = imports.elements.map(function (imp, i) { return [imp, params[i]]; });
        }
        return outnode;
    });
}
function default_1(ast, options) {
    options = object_assign_1.default({
        cjs: true,
        // TODO
        amd: false,
        es6: true
    }, options);
    var result = [];
    if (options.cjs) {
        result.push.apply(result, findCJS(ast));
    }
    if (options.es6) {
        result.push.apply(result, ast.body
            .filter(function (node) { return node.type === 'ImportDeclaration'; })
            .map(function (node) { return new ImportNode_1.default(ast, node, node); }));
    }
    if (options.amd) {
        result.push.apply(result, findAMD(ast));
    }
    return result.sort(function (a, b) { return a.start - b.start; });
}
exports.default = default_1;
