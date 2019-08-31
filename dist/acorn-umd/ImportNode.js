"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
var Node_1 = require("./Node");
var es_lookup_scope_1 = require("es-lookup-scope");
var ImportNode = /** @class */ (function (_super) {
    __extends(ImportNode, _super);
    function ImportNode(ast, reference, settings) {
        var _this = _super.call(this, settings) || this;
        _this.reference = reference;
        _this.ast = ast;
        return _this;
    }
    Object.defineProperty(ImportNode.prototype, "scope", {
        get: function () {
            return es_lookup_scope_1.default(this, this.ast);
        },
        enumerable: true,
        configurable: true
    });
    return ImportNode;
}(Node_1.default));
exports.default = ImportNode;
