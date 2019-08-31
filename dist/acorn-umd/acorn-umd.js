"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var lodash_1 = require("lodash");
var estraverse = require("estraverse");
var Node_1 = require("./Node");
var ImportNode_1 = require("./ImportNode");
var isRequireCallee = lodash_1.matches({
    type: 'CallExpression',
    callee: {
        name: 'require',
        type: 'Identifier'
    }
});
var isDefineCallee = lodash_1.matches({
    type: 'CallExpression',
    callee: {
        name: 'define',
        type: 'Identifier'
    }
});
var isArrayExpr = lodash_1.matches({
    type: 'ArrayExpression'
});
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
        imported = lodash_1.clone(definition.property);
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
    estraverse.traverse(ast, {
        enter: function (node) {
            function checkRequire(expr) {
                if (lodash_1.result(expr, 'type') === 'MemberExpression') {
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
    return lodash_1.reject(requires, function (node) {
        return requires.some(function (parent) {
            return [node.start, node.stop].some(function (pos) { return pos > parent.start && pos < parent.end; });
        });
    })
        .map(function (node) { return constructCJSImportNode(ast, node); });
}
// Note there can be more than one define per file with global registeration.
function findAMD(ast) {
    return lodash_1.map(lodash_1.filter(ast.body, {
        type: 'ExpressionStatement'
    }), 'expression')
        .filter(isDefineCallee)
        // Ensure the define takes params and has a function
        .filter(function (node) { return node.arguments.length <= 3; })
        .filter(function (node) { return lodash_1.filter(node.arguments, isFuncExpr).length === 1; })
        .filter(function (node) { return lodash_1.filter(node.arguments, isArrayExpr).length <= 1; })
        // Now just zip the array arguments and the provided function params
        .map(function (node) {
        var outnode = constructImportNode(ast, node, 'AMDImport');
        var func = lodash_1.find(node.arguments, isFuncExpr);
        var imports = lodash_1.find(node.arguments, isArrayExpr) || { elements: [] };
        var params = lodash_1.take(func.params, imports.elements.length);
        outnode.specifiers = params;
        if (imports) {
            // Use an array even though its not spec as there isn't a better way to
            // represent this structure
            outnode.sources = imports.elements.map(function (imp) { return createSourceNode(node, imp); });
            // Make nicer repr: [[importSrc, paramName]]
            outnode.imports = lodash_1.zip(imports.elements, params);
        }
        return outnode;
    });
}
function default_1(ast, options) {
    options = lodash_1.assign({
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
        result.push.apply(result, lodash_1.filter(ast.body, {
            type: 'ImportDeclaration'
        })
            .map(function (node) { return new ImportNode_1.default(ast, node, node); }));
    }
    if (options.amd) {
        result.push.apply(result, findAMD(ast));
    }
    return lodash_1.sortBy(result, 'start');
}
exports.default = default_1;
