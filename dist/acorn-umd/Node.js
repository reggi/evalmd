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
var lodash_1 = require("lodash");
var acorn_1 = require("acorn");
var NodeHelper = /** @class */ (function (_super) {
    __extends(NodeHelper, _super);
    // @ts-ignore
    function NodeHelper(settings) {
        var _this = this;
        // @ts-ignore
        lodash_1.merge(_this, settings);
        return _this;
    }
    return NodeHelper;
}(acorn_1.Node));
exports.default = NodeHelper;
