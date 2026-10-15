/**
 * The `must-use-result` rule (LN-6): a `Result`, or a promise of one, may not be thrown away. A
 * discarded `Result<void, E>` is exactly the shape of a write whose failure nobody handled, and no
 * rule in typescript-eslint sees it.
 *
 * A `Result` is recognised by its shape, not its name: a union with a member whose `ok` can be the
 * literal `true` and one whose `ok` can be the literal `false`. So the rule works for any project's
 * own `Result` type, and for one imported under another name.
 *
 * It reports a `Result` discarded as a statement (alone, after `void`, or as any part of a comma
 * expression), and one returned by an arrow function where the caller ignores the return value: a
 * callback typed to return `void`, as `forEach`'s is.
 */
import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";
import ts from "typescript";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/odclcslkrpb5k/paranoid-typescript/blob/main/examples/lint/${name}.ts`,
);

/** The boolean literal types `type` can be: both for `boolean`, one for `true`, none for `never`. */
function booleanLiterals(checker: ts.TypeChecker, type: ts.Type): ReadonlySet<boolean> {
  const members = type.isUnion() ? type.types : [type];
  const found = new Set<boolean>();
  for (const member of members) {
    if ((member.flags & ts.TypeFlags.BooleanLiteral) === 0) continue;
    found.add(member === checker.getTrueType());
  }
  return found;
}

function isResult(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (!type.isUnion()) return false;
  let sawTrue = false;
  let sawFalse = false;
  for (const member of type.types) {
    // A member with no `ok` (`undefined`, from `obj?.save()`) does not disqualify the union.
    const ok = member.getProperty("ok");
    if (ok === undefined) continue;
    const literals = booleanLiterals(checker, checker.getTypeOfSymbol(ok));
    sawTrue ||= literals.has(true);
    sawFalse ||= literals.has(false);
  }
  return sawTrue && sawFalse;
}

/** True when `type`, or what awaiting it gives, is a `Result`. */
function holdsResult(checker: ts.TypeChecker, type: ts.Type): boolean {
  return isResult(checker, type) || isResult(checker, checker.getAwaitedType(type) ?? type);
}

/** True when the function type the context expects for `node` returns `void`. */
function contextReturnsVoid(checker: ts.TypeChecker, node: ts.Expression): boolean {
  const expected = checker.getContextualType(node);
  if (expected === undefined) return false;
  const signatures = expected.getCallSignatures();
  return (
    signatures.length > 0 &&
    signatures.every((s) => (s.getReturnType().flags & ts.TypeFlags.Void) !== 0)
  );
}

export const mustUseResult = createRule({
  name: "must-use-result",
  meta: {
    type: "problem",
    docs: { description: "Require every Result, or promise of one, to be used" },
    messages: {
      discarded:
        "This Result is discarded. Assign it, return it, or branch on `ok`: an unhandled failure " +
        "is the defect this rule exists to refuse (LN-6).",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    function check(expression: TSESTree.Expression): void {
      if (expression.type === AST_NODE_TYPES.SequenceExpression) {
        for (const part of expression.expressions) check(part);
        return;
      }
      // `void f()` is as much a discard as `f()`, so it is unwrapped rather than exempted.
      if (expression.type === AST_NODE_TYPES.UnaryExpression && expression.operator === "void") {
        check(expression.argument);
        return;
      }
      if (expression.type === AST_NODE_TYPES.AssignmentExpression) return;
      if (holdsResult(checker, services.getTypeAtLocation(expression))) {
        context.report({ node: expression, messageId: "discarded" });
      }
    }

    return {
      ExpressionStatement(node) {
        check(node.expression);
      },
      ArrowFunctionExpression(node) {
        if (node.body.type === AST_NODE_TYPES.BlockStatement) return;
        const arrow = services.esTreeNodeToTSNodeMap.get(node);
        if (!contextReturnsVoid(checker, arrow)) return;
        if (holdsResult(checker, services.getTypeAtLocation(node.body))) {
          context.report({ node: node.body, messageId: "discarded" });
        }
      },
    };
  },
});

export const plugin = {
  meta: { name: "paranoid", version: "0.0.0" },
  rules: { "must-use-result": mustUseResult },
};
