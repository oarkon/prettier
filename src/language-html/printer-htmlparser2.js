"use strict";

const embed = require("./embed");
const clean = require("./clean");
const { getLast, hasIgnoreComment } = require("../common/util");
const { isNextLineEmpty } = require("../common/util-shared");
const {
  builders: {
    concat,
    join,
    line,
    hardline,
    softline,
    literalline,
    group,
    indent,
    align,
    conditionalGroup,
    fill,
    ifBreak,
    breakParent,
    lineSuffixBoundary,
    addAlignmentToDoc,
    dedent
  },
  utils: { willBreak, isLineNext, isEmpty, removeLines },
  printer: { printDocToString }
} = require("../doc");

function genericPrint(path, options, print) {
  const n = path.getValue();
  if (!n) {
    return "";
  }

  if (typeof n === "string") {
    return n;
  }

  switch (n.type) {
    case "root": {
      return concat(printChildren(path, print, options));
    }
    case "directive": {
      return concat(["<", n.data, ">", hardline]);
    }
    case "text": {
      const parentNode = path.getParentNode();

      if (parentNode && isPreformattedTagNode(parentNode)) {
        return n.data;
      }

      return n.data.replace(/\s+/g, " ").trim();
    }
    case "script":
    case "style":
    case "tag": {
      const isVoid = isVoidTagNode(n);
      const openingPrinted = printOpeningPart(path, print);

      // Print self closing tag
      if (isVoid) {
        return concat([openingPrinted]);
      }

      const closingPrinted = printClosingPart(path, print);
      const hasChildren = n.children.length > 0;

      // Print tags without children
      if (!hasChildren) {
        return concat([openingPrinted, closingPrinted]);
      }

      const children = printChildren(path, print, options);
      const isScriptTag = isScriptTagNode(n);

      if (isScriptTag) {
        return group(
          concat([openingPrinted, concat(children), closingPrinted])
        );
      }

      const containsTag =
        n.children.filter(
          node => ["script", "style", "tag"].indexOf(node.type) !== -1
        ).length > 0;
      const containsMultipleAttributes = n.attributes.length > 1;

      let forcedBreak =
        willBreak(openingPrinted) || containsTag || containsMultipleAttributes;

      // Trim trailing lines (or empty strings)
      while (
        children.length &&
        (isLineNext(getLast(children)) || isEmpty(getLast(children)))
      ) {
        children.pop();
      }

      // Trim leading lines (or empty strings)
      while (
        children.length &&
        (isLineNext(children[0]) || isEmpty(children[0])) &&
        (isLineNext(children[1]) || isEmpty(children[1]))
      ) {
        children.shift();
        children.shift();
      }

      // Detect whether we will force this element to output over multiple lines.
      const multilineChildren = [];

      children.forEach(child => {
        multilineChildren.push(child);

        if (willBreak(child)) {
          forcedBreak = true;
        }
      });

      const printedMultilineChildren = concat([
        !isScriptTag ? hardline : "",
        group(concat(multilineChildren), { shouldBreak: true })
      ]);

      const multiLineElem = group(
        concat([
          openingPrinted,
          indent(printedMultilineChildren),
          hardline,
          closingPrinted
        ])
      );

      if (forcedBreak) {
        return multiLineElem;
      }

      return conditionalGroup([
        group(concat([openingPrinted, concat(children), closingPrinted])),
        multiLineElem
      ]);
    }
    case "comment": {
      return concat(["<!--", n.data, "-->"]);
    }
    case "attribute": {
      if (!n.value) {
        if (isBooleanAttributeNode(n)) {
          return n.key;
        }

        return concat([n.key, '=""']);
      }

      return concat([n.key, '="', n.value.replace(/"/g, "&quot;"), '"']);
    }

    default:
      /* istanbul ignore next */
      throw new Error("unknown htmlparser2 type: " + n.type);
  }
}

function isBooleanAttributeNode(node) {
  return (
    node.type === "attribute" &&
    [
      "allowfullscreen",
      "allowpaymentrequest",
      "async",
      "autofocus",
      "autoplay",
      "checked",
      "controls",
      "default",
      "defer",
      "disabled",
      "formnovalidate",
      "hidden",
      "ismap",
      "itemscope",
      "loop",
      "multiple",
      "muted",
      "nomodule",
      "novalidate",
      "open",
      "readonly",
      "required",
      "reversed",
      "selected",
      "typemustmatch"
    ].indexOf(node.key.toLowerCase()) !== -1
  );
}

// http://w3c.github.io/html/single-page.html#void-elements
function isVoidTagNode(node) {
  return (
    node.type === "tag" &&
    [
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr"
    ].indexOf(node.name.toLowerCase()) !== -1
  );
}

function isPreformattedTagNode(node) {
  return node.type === "tag" && ["pre"].indexOf(node.name.toLowerCase()) !== -1;
}

function isScriptTagNode(node) {
  return (
    (node.type === "script" || node.type === "style") &&
    ["script", "style"].indexOf(node.name.toLowerCase()) !== -1
  );
}

function printOpeningPart(path, print) {
  const n = path.getValue();
  const isVoid = isVoidTagNode(n);

  // Don't break self-closing elements with no attributes
  if (isVoid && !n.attributes.length) {
    return concat(["<", n.name, " />"]);
  }

  // don't break up opening elements with a single long text attribute
  if (n.attributes && n.attributes.length === 1 && n.attributes[0].value) {
    return group(
      concat([
        "<",
        path.call(print, "name"),
        " ",
        concat(path.map(print, "attributes")),
        n.selfClosing ? " />" : ">"
      ])
    );
  }

  return group(
    concat([
      "<",
      n.name,
      concat([
        indent(
          concat(path.map(attr => concat([line, print(attr)]), "attributes"))
        ),
        isVoid ? line : softline
      ]),
      isVoid ? "/>" : ">"
    ])
  );
}

function printClosingPart(path, print) {
  return concat(["</", path.call(print, "name"), ">"]);
}

function printChildren(path, print, options) {
  const parts = [];

  path.map(childPath => {
    const child = childPath.getValue();
    const printedChild = print(childPath);

    parts.push(printedChild);

    if (child.type !== "text" && child.type !== "directive") {
      parts.push(hardline);
    }

    if (isNextLineEmpty(options.originalText, childPath.getValue(), options)) {
      parts.push(hardline);
    }
  }, "children");

  return parts;
}

module.exports = {
  print: genericPrint,
  massageAstNode: clean,
  embed,
  hasPrettierIgnore: hasIgnoreComment
};
